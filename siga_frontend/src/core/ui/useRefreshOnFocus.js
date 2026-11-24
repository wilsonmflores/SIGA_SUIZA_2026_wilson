import { useEffect, useRef } from 'react';

/**
 * Vuelve a ejecutar `fn` cuando la ventana recupera el foco o la pestaña
 * vuelve a estar visible (con throttle). Así una pantalla que quedó abierta
 * muestra los cambios hechos en otra PC/pestaña **sin recargar la página (F5)**.
 *
 * Uso: useRefreshOnFocus(() => cargarDatos());
 *
 * - `fn` se guarda en un ref: siempre se ejecuta la versión más reciente
 *   (cierra sobre el estado actual sin volver a montar el efecto).
 * - `minIntervalMs` evita ráfagas de peticiones al alternar ventanas.
 *
 * @param {Function} fn función a ejecutar al volver el foco (puede ser async)
 * @param {{minIntervalMs?: number}} [opciones]
 */
export function useRefreshOnFocus(fn, { minIntervalMs = 15000 } = {}) {
  const fnRef = useRef(fn);

  // Actualiza el ref en un efecto (nunca durante el render): el listener
  // siempre ejecuta la versión más reciente de `fn` sin re-suscribirse.
  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  useEffect(() => {
    let ultimo = 0;
    const refrescar = () => {
      const ahora = Date.now();
      if (ahora - ultimo < minIntervalMs) return;
      ultimo = ahora;
      try {
        const resultado = fnRef.current();
        if (resultado && typeof resultado.catch === 'function') {
          resultado.catch(() => {}); // los loaders ya manejan sus errores
        }
      } catch {
        // nunca debe romper la ventana por un refresco de fondo
      }
    };
    const alVolver = () => {
      if (document.visibilityState === 'visible') refrescar();
    };
    window.addEventListener('focus', alVolver);
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      window.removeEventListener('focus', alVolver);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [minIntervalMs]);
}
