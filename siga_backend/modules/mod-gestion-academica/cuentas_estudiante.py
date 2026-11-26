"""Cuentas de usuario automáticas de los estudiantes al matricular.

Reglas de negocio (punto "cuentas de estudiantes"):
- Al matricular por **primera vez** se crea la cuenta en ``core_users``.
- Correo institucional: nombre y apellidos normalizados ``@siga.edu``
  (ej. ``valentina.acosta.lizcielo@siga.edu``). Si el correo ya pertenece a
  otra persona (homónimos) se agrega el DNI y, en último caso, se usa el
  DNI como parte local.
- Contraseña: el **DNI** del estudiante.
- Rol asignado: ``estudiante``.
- Si ``estudiantes.email_institucional`` estaba vacío se rellena con el
  correo generado, de modo que el alumno siempre sepa cuál es su correo.

El procedimiento es **idempotente**: llamarlo varias veces (o para el mismo
alumno en varios flujos de matrícula) nunca genera cuentas duplicadas.
"""

from __future__ import annotations

import re
import unicodedata

import bcrypt
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


def normalizar_nombre(texto: str) -> str:
    """``'Valentina Acosta Lizcielo'`` -> ``'valentina.acosta.lizcielo'``."""
    sin_tildes = (
        unicodedata.normalize("NFKD", texto or "")
        .encode("ascii", "ignore")
        .decode("ascii")
    )
    limpio = re.sub(r"[^a-zA-Z0-9]+", " ", sin_tildes).strip().lower()
    return limpio.replace(" ", ".")


def candidatos_email(estudiante) -> list[str]:
    """Candidatos en orden de preferencia para el correo institucional."""
    base = normalizar_nombre(
        f"{getattr(estudiante, 'nombres', None) or ''} {getattr(estudiante, 'apellidos', None) or ''}"
    )
    dni = str(getattr(estudiante, "dni", None) or "").strip()
    if not base:
        base = f"estudiante{dni}"
    candidatos = [f"{base}@siga.edu"]
    if dni:
        candidatos.append(f"{base}.{dni}@siga.edu")
        candidatos.append(f"{dni}@siga.edu")
    return candidatos


async def _existe_usuario(db: AsyncSession, email: str) -> bool:
    fila = await db.execute(
        text("SELECT 1 FROM core_users WHERE lower(email) = :email LIMIT 1"),
        {"email": email.lower()},
    )
    return fila.first() is not None


async def asegurar_cuenta_estudiante(db: AsyncSession, estudiante) -> str | None:
    """Crea (si hace falta) la cuenta del estudiante.

    Devuelve el correo creado, o ``None`` si ya tenía cuenta.
    """
    dni = str(getattr(estudiante, "dni", None) or "").strip()
    if not dni:
        return None

    email_actual = (
        getattr(estudiante, "email_institucional", None) or ""
    ).strip().lower()

    if email_actual.endswith("@siga.edu"):
        if await _existe_usuario(db, email_actual):
            return None  # ya tiene cuenta
        candidatos = [email_actual] + [
            c for c in candidatos_email(estudiante) if c != email_actual
        ]
    else:
        # Vacio o correo personal (gmail, etc.): la cuenta SIEMPRE se genera
        # con el nombre del alumno (@siga.edu), nunca con el correo personal.
        candidatos = candidatos_email(estudiante)

    hash_dni = bcrypt.hashpw(dni.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    nombre_completo = (
        f"{getattr(estudiante, 'nombres', None) or ''} "
        f"{getattr(estudiante, 'apellidos', None) or ''}"
    ).strip()

    for email in candidatos:
        if await _existe_usuario(db, email):
            continue  # ocupado por otra persona: probar el siguiente
        fila = await db.execute(
            text(
                """
                INSERT INTO core_users (id, email, full_name, hashed_password, is_active, is_superuser, created_at)
                SELECT COALESCE(MAX(id), 0) + 1, :email, :full_name, :hash, true, false, now()
                FROM core_users
                ON CONFLICT (email) DO NOTHING
                RETURNING id
                """
            ),
            {"email": email, "full_name": nombre_completo, "hash": hash_dni},
        )
        user_id = fila.scalar_one_or_none()
        if user_id is None:
            continue  # carrera con otro proceso: siguiente candidato

        rol = (
            await db.execute(
                text("SELECT id FROM core_roles WHERE name = 'estudiante' LIMIT 1")
            )
        ).scalar_one_or_none()
        if rol is not None:
            await db.execute(
                text(
                    """
                    INSERT INTO core_user_roles (user_id, role_id)
                    VALUES (:uid, :rid)
                    ON CONFLICT DO NOTHING
                    """
                ),
                {"uid": user_id, "rid": rol},
            )

        # Dejar el correo institucional reflejado en la ficha del estudiante.
        if email_actual != email:
            estudiante.email_institucional = email

        await db.flush()
        return email

    return None
