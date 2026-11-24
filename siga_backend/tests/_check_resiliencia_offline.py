"""Verificacion rapida (sin BD) de los cambios de resiliencia y permisos."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import asyncio

from app.core.resilience.health_monitor import ModuleHealth, HealthStatus, UMBRAL_FALLOS_CONSECUTIVOS
from app.core.resilience.fallback_manager import fallback_manager

fallos = 0


def check(cond, msg):
    global fallos
    print(("  OK  " if cond else " FAIL ") + msg)
    if not cond:
        fallos += 1


# 1) Health monitor: un timeout aislado NO degrada; N consecutivos SÍ.
h = ModuleHealth("mod-test")
h.registrar_fallo(HealthStatus.UNHEALTHY, 10.0, "Timeout")
check(h.status == HealthStatus.HEALTHY, f"1 fallo no degrada (status={h.status.value})")
for _ in range(UMBRAL_FALLOS_CONSECUTIVOS - 2):
    h.registrar_fallo(HealthStatus.UNHEALTHY, 10.0, "Timeout")
check(h.status == HealthStatus.HEALTHY, f"{UMBRAL_FALLOS_CONSECUTIVOS - 1} fallos aún no degradan (status={h.status.value})")
h.registrar_fallo(HealthStatus.UNHEALTHY, 10.0, "Timeout")
check(h.status == HealthStatus.UNHEALTHY, f"{UMBRAL_FALLOS_CONSECUTIVOS} fallos consecutivos degradan (status={h.status.value})")
h.registrar_exito(0.1)
h.update(HealthStatus.HEALTHY, 0.1)
check(h.status == HealthStatus.HEALTHY and h.fallos_consecutivos == 0, "un 200 repone la salud y reinicia el contador")

# 2) Fallback: las escrituras NUNCA se responden con caché.
# (Redis no esta conectado en local: se sustituye por un doble en memoria
#  para validar la logica de claves del propio fallback_manager.)
from app.core.resilience.cache_manager import cache_manager


class _FakeRedis:
    def __init__(self):
        self.d = {}

    async def get(self, k):
        return self.d.get(k)

    async def setex(self, k, ttl, v):
        self.d[k] = v


cache_manager.redis_client = _FakeRedis()


async def main():
    # sembrar cache con una lectura simulada
    await fallback_manager.cache_successful_response("mod-x", "/estudiantes", [{"dni": "123"}])
    lectura = await fallback_manager.handle_module_request("mod-x", "/estudiantes", method="GET")
    check(lectura["status"] == "cached", "GET sí sirve la caché (status=%s)" % lectura["status"])
    escritura = await fallback_manager.handle_module_request("mod-x", "/estudiantes", method="POST")
    check(escritura["status"] != "cached", "POST NO sirve caché (status=%s)" % escritura["status"])
    clave_get = fallback_manager._build_cache_key("mod-x", "/estudiantes", "GET")
    clave_post = fallback_manager._build_cache_key("mod-x", "/estudiantes", "POST")
    check(clave_get != clave_post, "claves de caché distintas por método")
    # existe caché GET? comprobar que un PUT tampoco la lee
    put = await fallback_manager.handle_module_request("mod-x", "/estudiantes", method="PUT")
    check(put["status"] != "cached", "PUT NO sirve caché (status=%s)" % put["status"])

asyncio.run(main())

print("\nRESULTADO:", "TODO OK" if fallos == 0 else f"{fallos} fallas")
raise SystemExit(1 if fallos else 0)
