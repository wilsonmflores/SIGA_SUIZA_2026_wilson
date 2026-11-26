"""Cuentas automáticas de estudiantes al matricular (punto "cuentas").

Verifica que la primera matrícula cree la cuenta en ``core_users`` con:
- correo institucional generado con el nombre del alumno (@siga.edu),
- contraseña = DNI (hash bcrypt verificable),
- rol ``estudiante``,
- ``estudiantes.email_institucional`` rellenado,
y que el procedimiento sea idempotente y resuelva homónimos.
"""
import bcrypt
import pytest
from sqlalchemy import select, text

from helpers.module_loader import load_module_component


@pytest.fixture
def cuentas_mod():
    return load_module_component("mod-gestion-academica", "cuentas_estudiante")


async def _estudiante_orm(db, est_id: int):
    modelos = load_module_component("mod-gestion-academica", "models")
    res = await db.execute(select(modelos.Estudiante).where(modelos.Estudiante.id == est_id))
    return res.scalar_one()


async def _usuario_por_email(db, email: str):
    res = await db.execute(
        text("SELECT id, hashed_password, is_active, is_superuser FROM core_users WHERE lower(email) = :e"),
        {"e": email.lower()},
    )
    return res.mappings().first()


async def test_primera_matricula_crea_cuenta_con_nombre_y_password_dni(
    db_session, fixture_estudiante, cuentas_mod
):
    est = await _estudiante_orm(db_session, 100)
    assert not est.email_institucional

    email = await cuentas_mod.asegurar_cuenta_estudiante(db_session, est)
    await db_session.commit()

    # Correo generado con el nombre normalizado
    assert email == "estudiante.prueba.siga@siga.edu"

    usuario = await _usuario_por_email(db_session, email)
    assert usuario is not None, "La cuenta del estudiante debió crearse en core_users"
    assert usuario["is_active"] is True
    assert usuario["is_superuser"] is False

    # La contraseña es el DNI (hash bcrypt verificable)
    assert bcrypt.checkpw(b"00000001", usuario["hashed_password"].encode("utf-8"))

    # Rol estudiante asignado
    roles = (
        await db_session.execute(
            text(
                "SELECT r.name FROM core_user_roles ur JOIN core_roles r ON r.id = ur.role_id WHERE ur.user_id = :u"
            ),
            {"u": usuario["id"]},
        )
    ).scalars().all()
    assert "estudiante" in roles

    # El correo institucional queda reflejado en la ficha del estudiante
    assert est.email_institucional == email


async def test_segunda_llamada_no_crea_cuentas_duplicadas(
    db_session, fixture_estudiante, cuentas_mod
):
    est = await _estudiante_orm(db_session, 100)

    primera = await cuentas_mod.asegurar_cuenta_estudiante(db_session, est)
    segunda = await cuentas_mod.asegurar_cuenta_estudiante(db_session, est)
    await db_session.commit()

    assert primera == "estudiante.prueba.siga@siga.edu"
    assert segunda is None, "La segunda llamada no debe crear otra cuenta"

    total = (
        await db_session.execute(
            text("SELECT COUNT(*) FROM core_users WHERE lower(email) LIKE 'estudiante.prueba.siga%'")
        )
    ).scalar()
    assert total == 1


async def test_homonimo_recibe_correo_con_dni(db_session, fixture_estudiante, cuentas_mod):
    # Primer estudiante: se queda con el correo base
    est1 = await _estudiante_orm(db_session, 100)
    email1 = await cuentas_mod.asegurar_cuenta_estudiante(db_session, est1)

    # Homónimo: mismos nombres, distinto DNI
    await db_session.execute(
        text(
            """
            INSERT INTO estudiantes (id, codigo_estudiante, dni, nombres, apellidos, programa_id,
                                     estado_academico, pago_matricula, documentos_completos, created_at, updated_at)
            VALUES (101, 'TEST-00000002', '00000002', 'Estudiante', 'Prueba SIGA', 1,
                    'regular', true, true, NOW(), NOW())
            ON CONFLICT (id) DO NOTHING
            """
        )
    )
    await db_session.commit()

    est2 = await _estudiante_orm(db_session, 101)
    email2 = await cuentas_mod.asegurar_cuenta_estudiante(db_session, est2)
    await db_session.commit()

    assert email1 == "estudiante.prueba.siga@siga.edu"
    assert email2 == "estudiante.prueba.siga.00000002@siga.edu"
    assert email1 != email2

    # Ambas cuentas existen y su contraseña es el DNI de cada uno
    u1 = await _usuario_por_email(db_session, email1)
    u2 = await _usuario_por_email(db_session, email2)
    assert u1 and u2
    assert bcrypt.checkpw(b"00000001", u1["hashed_password"].encode("utf-8"))
    assert bcrypt.checkpw(b"00000002", u2["hashed_password"].encode("utf-8"))


async def test_correo_personal_no_se_usa_como_institucional(
    db_session, fixture_estudiante, cuentas_mod
):
    """Si el alumno tiene un gmail en email_institucional, la cuenta se genera
    con su nombre @siga.edu (regla: correo = nombre, contraseña = DNI)."""
    await db_session.execute(
        text("UPDATE estudiantes SET email_institucional = 'alumno.personal@gmail.com' WHERE id = 100")
    )
    await db_session.commit()

    est = await _estudiante_orm(db_session, 100)
    email = await cuentas_mod.asegurar_cuenta_estudiante(db_session, est)
    await db_session.commit()

    assert email == "estudiante.prueba.siga@siga.edu"
    # La ficha queda con el correo institucional, no con el personal
    assert est.email_institucional == "estudiante.prueba.siga@siga.edu"
    # Y no se creó ninguna cuenta con el gmail personal
    total_gmail = (
        await db_session.execute(
            text("SELECT COUNT(*) FROM core_users WHERE lower(email) LIKE '%gmail.com'")
        )
    ).scalar()
    assert total_gmail == 0


async def test_no_toca_cuentas_existentes(db_session, fixture_estudiante, cuentas_mod):
    """Un estudiante cuyo correo institucional ya tiene usuario no se duplica."""
    await db_session.execute(
        text(
            """
            INSERT INTO core_users (id, email, full_name, hashed_password, is_active, is_superuser, created_at)
            VALUES (777, 'ya.tiene.cuenta@siga.edu', 'Cuenta Previa', 'hash', true, false, NOW())
            ON CONFLICT (email) DO NOTHING
            """
        )
    )
    await db_session.execute(
        text("UPDATE estudiantes SET email_institucional = 'ya.tiene.cuenta@siga.edu' WHERE id = 100")
    )
    await db_session.commit()

    est = await _estudiante_orm(db_session, 100)
    email = await cuentas_mod.asegurar_cuenta_estudiante(db_session, est)
    await db_session.commit()

    assert email is None, "No debe crear una segunda cuenta si el correo ya tiene usuario"
    total = (
        await db_session.execute(
            text("SELECT COUNT(*) FROM core_users WHERE lower(email) LIKE 'ya.tiene.cuenta%'")
        )
    ).scalar()
    assert total == 1
