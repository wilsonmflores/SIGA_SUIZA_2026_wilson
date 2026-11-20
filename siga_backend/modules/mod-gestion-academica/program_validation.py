from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def validar_programa_activo(db: AsyncSession, programa_id: int | None) -> None:
    """Impide asociar estudiantes a programas inexistentes o fuera de oferta."""
    if programa_id is None:
        raise HTTPException(status_code=422, detail="Debe seleccionar un programa de estudios.")

    result = await db.execute(
        text("SELECT id, estado FROM programas_estudio WHERE id = :programa_id"),
        {"programa_id": programa_id},
    )
    programa = result.mappings().first()
    if not programa:
        raise HTTPException(
            status_code=422,
            detail=f"El programa de estudios {programa_id} no existe. Seleccione un programa válido.",
        )

    estado = (programa["estado"] or "activo").strip().lower()
    if estado != "activo":
        raise HTTPException(
            status_code=422,
            detail="No se pueden registrar estudiantes en un programa inactivo o cerrado.",
        )


async def contar_referencias(db: AsyncSession, tabla: str, columna: str, valor: int) -> int:
    """Cuenta relaciones de tablas opcionales sin fallar si una aún no fue desplegada."""
    exists = await db.execute(
        text("""
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name = :tabla AND column_name = :columna
            )
        """),
        {"tabla": tabla, "columna": columna},
    )
    if not exists.scalar():
        return 0

    # Los nombres provienen exclusivamente de las listas constantes en los endpoints.
    result = await db.execute(
        text(f'SELECT count(*) FROM "{tabla}" WHERE "{columna}" = :valor'),
        {"valor": valor},
    )
    return int(result.scalar() or 0)
