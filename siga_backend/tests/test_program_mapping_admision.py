"""Pruebas del mapeo de carreras de Admisión contra el catálogo REAL.

Regresión: `GET /admitidos` usaba un diccionario de ids fijo (por ejemplo
"GESTIÓN ADMINISTRATIVA" -> 4). En una BD donde esa carrera tiene id=1 la
ingesta fallaba con "El programa de estudios 4 no existe. Seleccione un
programa válido", aunque la carrera existiera en el catálogo.

El mapeo ahora se hace por nombre contra `programas_estudio`, así que estas
pruebas cubren el comportamiento puro (sin base de datos).
"""
import importlib.util
from pathlib import Path

_MOD = Path(__file__).resolve().parents[1] / "modules" / "mod-admision" / "program_mapping.py"
_spec = importlib.util.spec_from_file_location("program_mapping_admision", _MOD)
program_mapping = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(program_mapping)

resolver_programa = program_mapping.resolver_programa
normalizar_nombre = program_mapping.normalizar_nombre

CATALOGO = [
    (1, "Gestión Administrativa"),
    (7, "Contabilidad General"),
]


def test_resuelve_por_nombre_ignorando_tildes_y_mayusculas():
    assert resolver_programa("GESTIÓN ADMINISTRATIVA", CATALOGO)[0] == 1
    assert resolver_programa("gestión administrativa", CATALOGO)[0] == 1


def test_resuelve_por_contencion_de_texto():
    assert resolver_programa("contabilidad", CATALOGO)[0] == 7
    assert resolver_programa("CONTABILIDAD GENERAL EFINANCIERA", CATALOGO)[0] == 7


def test_carrera_inexistente_devuelve_none():
    # Antes devolvía 99 o un id fijo del mapa; ahora None para que el core
    # responda con un mensaje claro y accionable.
    assert resolver_programa("MANEJO FORESTAL", CATALOGO) == (None, None)


def test_catalogo_vacio_o_nombre_vacio_devuelven_none():
    assert resolver_programa("Gestión Administrativa", []) == (None, None)
    assert resolver_programa("", CATALOGO) == (None, None)
    assert resolver_programa(None, CATALOGO) == (None, None)


def test_normalizar_nombre():
    assert normalizar_nombre("  Gestión   Administrativa ") == "GESTION ADMINISTRATIVA"
    assert normalizar_nombre(None) == ""
