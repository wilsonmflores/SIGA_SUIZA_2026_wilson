"""Resolución de carreras del Excel de Admisión contra el catálogo REAL.

Los IDs de `programas_estudio` cambian entre entornos (una BD nueva empieza en
id=1, otra puede tener huecos), así que el mapeo se hace por NOMBRE contra la
tabla real y nunca con un diccionario fijo: con ids hardcodeados los ingresantes
se asociaban a programas que no existían y la ingesta fallaba con
"El programa de estudios X no existe".
"""
from __future__ import annotations

import re
import unicodedata


def normalizar_nombre(texto) -> str:
    """Mayúsculas, sin tildes y con espacios simples (para comparar nombres)."""
    base = unicodedata.normalize("NFD", str(texto or ""))
    sin_tildes = "".join(c for c in base if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", sin_tildes).strip().upper()


def resolver_programa(nombre_excel, catalogo):
    """Busca la carrera del Excel en el catálogo de la BD.

    catalogo: iterable de pares (id, nombre) provenientes de `programas_estudio`.

    Returns:
        (id, nombre_del_catalogo) si hay coincidencia exacta o por contención;
        (None, None) si la carrera no existe en el catálogo.
    """
    objetivo = normalizar_nombre(nombre_excel)
    if not objetivo:
        return None, None

    pares = [(pid, nombre, normalizar_nombre(nombre)) for pid, nombre in catalogo]

    # 1) coincidencia exacta (la más común: el Excel trae el nombre oficial)
    for pid, nombre, clave in pares:
        if objetivo == clave:
            return pid, nombre

    # 2) por contención: "CONTABILIDAD" vs "CONTABILIDAD GENERAL", etc.
    for pid, nombre, clave in pares:
        if objetivo in clave or clave in objetivo:
            return pid, nombre

    return None, None
