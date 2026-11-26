"""Backfill: crea las cuentas de usuario de todos los estudiantes existentes.

Reglas (igual que la creación automática al matricular):
- Correo: nombre.apellidos@siga.edu (si choca, agrega el DNI; último
  recurso, el DNI solo).
- Contraseña: el DNI del estudiante.
- Rol: estudiante.
- Rellena ``estudiantes.email_institucional`` si estaba vacío.

Uso:
    python tools/crear_cuentas_estudiantes.py --dsn postgresql://... [--dry-run]

En desarrollo local:
    python tools/crear_cuentas_estudiantes.py --dsn postgresql://postgres:wilson21@127.0.0.1:5432/siga_core
"""

import argparse
import asyncio
import os
import sys
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Crea cuentas de estudiantes que aún no tienen.")
    parser.add_argument("--dsn", default=os.getenv("DATABASE_URL"), help="URL de la base de datos destino")
    parser.add_argument("--dry-run", action="store_true", help="Solo reporta, no escribe")
    args = parser.parse_args()

    if not args.dsn:
        sys.exit("Falta la base de datos: use --dsn o la variable DATABASE_URL.")

    # El database.py del módulo construye su motor desde DATABASE_URL.
    os.environ["DATABASE_URL"] = args.dsn

    module_dir = Path(__file__).resolve().parents[1] / "modules" / "mod-gestion-academica"
    sys.path.insert(0, str(module_dir))

    from sqlalchemy import text  # noqa: E402

    from database import AsyncSessionLocal  # noqa: E402
    from cuentas_estudiante import (  # noqa: E402
        asegurar_cuenta_estudiante,
        candidatos_email,
    )
    from models import Estudiante  # noqa: E402
    from sqlalchemy import select  # noqa: E402

    async def run() -> None:
        async with AsyncSessionLocal() as db:
            if args.dry_run:
                res = await db.execute(
                    text(
                        """
                        SELECT e.id, e.dni, e.nombres, e.apellidos, e.email_institucional,
                               EXISTS(
                                   SELECT 1 FROM core_users u
                                   WHERE lower(u.email) = lower(e.email_institucional)
                               ) AS tiene_cuenta
                        FROM estudiantes e
                        ORDER BY e.id
                        """
                    )
                )
                filas = res.mappings().all()
                sin_cuenta = [f for f in filas if not f["tiene_cuenta"]]
                print(f"[DRY-RUN] Estudiantes: {len(filas)} | con cuenta: {len(filas) - len(sin_cuenta)} | sin cuenta: {len(sin_cuenta)}")
                for f in sin_cuenta[:20]:
                    ns = type("E", (), {"nombres": f["nombres"], "apellidos": f["apellidos"], "dni": f["dni"], "email_institucional": None})()
                    print(f"  - id={f['id']} dni={f['dni']} -> {candidatos_email(ns)[0]}")
                if len(sin_cuenta) > 20:
                    print(f"  ... y {len(sin_cuenta) - 20} más")
                return

            estudiantes = (await db.execute(select(Estudiante))).scalars().all()
            creadas, ya_tenian, sin_dni = [], [], []

            for est in estudiantes:
                if not str(est.dni or "").strip():
                    sin_dni.append(est.id)
                    continue
                email = await asegurar_cuenta_estudiante(db, est)
                if email:
                    creadas.append((est.id, email))
                else:
                    ya_tenian.append(est.id)

            await db.commit()

            print(f"Estudiantes procesados : {len(estudiantes)}")
            print(f"Cuentas creadas        : {len(creadas)}")
            print(f"Ya tenían cuenta       : {len(ya_tenian)}")
            print(f"Sin DNI (omitidos)     : {len(sin_dni)}")
            for est_id, email in creadas[:15]:
                print(f"  + estudiante {est_id}: {email} (contraseña = DNI)")
            if len(creadas) > 15:
                print(f"  ... y {len(creadas) - 15} más")

    asyncio.run(run())


if __name__ == "__main__":
    main()
