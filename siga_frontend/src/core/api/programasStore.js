import { useEffect, useState } from 'react';
import { API_BASE } from './client';

// ============================================================================
// STORE DE PROGRAMAS DE ESTUDIO (carreras)
// ============================================================================
// FUENTE DE VERDAD: tabla `programas_estudio` (GET /api/mod-programas-estudio/programas).
// Es el mismo catálogo que se crea/edita/elimina en Gestión Académica, de modo
// que el registro de estudiantes siempre muestre EXACTAMENTE las carreras que
// existen en la base de datos (si solo hay una, aparece una sola; si se
// eliminó una, desaparece de todos los formularios).
//
// PROGRAMAS_BASE solo se usa como respaldo si el servicio no responde (backend
// caído), para no dejar la interfaz completamente bloqueada.
//
// Si cambia un id aquí, también cambia en CAREERS_MAP (exportado y consumido
// por los módulos de Finanzas a través de tupaCatalog.js).
// ============================================================================

export const PROGRAMAS_BASE = [
  { id: '1', label: 'Desarrollo de Sistemas de Información', estado: 'activo' },
  { id: '2', label: 'Enfermería Técnica', estado: 'activo' },
  { id: '3', label: 'Asistencia Administrativa', estado: 'activo' },
  { id: '4', label: 'Gestión Administrativa', estado: 'activo' },
  { id: '5', label: 'Contabilidad', estado: 'activo' },
  { id: '6', label: 'Mecatrónica Automotriz', estado: 'activo' },
  { id: '7', label: 'Electricidad Industrial', estado: 'activo' },
  { id: '8', label: 'Administración de Operaciones Turísticas', estado: 'activo' },
  { id: '9', label: 'Construcción Civil', estado: 'activo' },
  { id: '10', label: 'Producción Agropecuaria', estado: 'activo' },
  { id: '11', label: 'Manejo Forestal', estado: 'activo' },
];

// Mapa id -> nombre consumido por Finanzas (tupaCatalog.CAREERS_MAP). Se
// reescribe completo con cada carga desde la BD para que nunca muestre
// carreras inexistentes ni oculte las recién creadas.
export const CAREERS_MAP = {};
PROGRAMAS_BASE.forEach(programa => {
  CAREERS_MAP[programa.id] = programa.label;
});

const normalizar = (programa) => ({
  id: String(programa.id),
  label: String(programa.nombre ?? programa.label ?? '').trim() || `Programa ${programa.id}`,
  estado: String(programa.estado ?? 'activo').trim().toLowerCase(),
});

const compararPorNombre = (a, b) =>
  a.label.localeCompare(b.label, 'es', { sensitivity: 'base' });

// Sincroniza CAREERS_MAP (mutación in-place: los consumidores importados con
// `import { CAREERS_MAP }` siempre ven el mismo objeto).
const sincronizarCareersMap = (lista) => {
  Object.keys(CAREERS_MAP).forEach(clave => delete CAREERS_MAP[clave]);
  lista.forEach(programa => {
    CAREERS_MAP[programa.id] = programa.label;
  });
};

let cache = null;            // Array<{id,label,estado}> | null (null = sin cargar)
let cargaEnCurso = null;     // promesa deduplicada
const suscriptores = new Set();

const notificar = () => {
  suscriptores.forEach(callback => callback(cache ?? []));
};

const aplicar = (lista) => {
  cache = lista;
  sincronizarCareersMap(lista);
  notificar();
};

const leerToken = () => {
  try {
    return localStorage.getItem('token');
  } catch {
    return null;
  }
};

/**
 * Descarga el catálogo de programas desde el Core Gateway.
 * - Si ya hay caché válida, no hace nada (pasar { fuerza: true } para refrescar).
 * - Nunca lanza: si el servicio falla se mantiene/usa el respaldo local.
 * @returns {Promise<Array>} lista de programas normalizada
 */
export const cargarProgramas = async ({ fuerza = false } = {}) => {
  if (!fuerza && cache) return cache;
  if (cargaEnCurso) return cargaEnCurso;

  cargaEnCurso = (async () => {
    try {
      const token = leerToken();
      // API_BASE = VITE_API_URL (produccion: URL absoluta del backend en
      // Railway; local: cadena vacia y usa el proxy de Vite). Sin la base,
      // en Vercel la peticion caeria en el rewrite de SPA y devolveria el
      // index.html en lugar del catalogo.
      const respuesta = await fetch(`${API_BASE}/api/mod-programas-estudio/programas`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
      const datos = await respuesta.json();
      if (!Array.isArray(datos)) throw new Error('Respuesta inesperada del servicio de programas');

      aplicar(datos.map(normalizar).sort(compararPorNombre));
      return cache;
    } catch (error) {
      console.error('No se pudo cargar el catálogo de programas:', error);
      // Respaldo local solo si nunca se logró cargar; si ya había datos
      // reales de la BD se conservan (nunca se "regresan" carreras viejas).
      if (cache === null) aplicar([...PROGRAMAS_BASE]);
      else notificar();
      return cache ?? [...PROGRAMAS_BASE];
    } finally {
      cargaEnCurso = null;
    }
  })();

  return cargaEnCurso;
};

/** Invalida la caché y recarga (llamar tras crear/editar/eliminar una carrera).
 *  No vacía la caché: mientras llega la respuesta se siguen mostrando los
 *  programas anteriores (sin parpadeo ni respaldo local intermedio). */
export const invalidarProgramas = () => cargarProgramas({ fuerza: true });

/** Suscribe un callback que recibirá la lista cada vez que cambie. */
export const suscribirProgramas = (callback) => {
  suscriptores.add(callback);
  return () => suscriptores.delete(callback);
};

/**
 * Programas cargados hasta el momento. Nunca devuelve null: mientras no haya
 * respuesta del servicio se entrega el respaldo local (PROGRAMAS_BASE), para
 * que ningún consumidor tenga que validar el caso "sin cargar".
 */
export const getProgramas = () => cache ?? PROGRAMAS_BASE;

/**
 * Solo las carreras en las que SÍ se puede matricular/registar estudiantes.
 * El backend (validar_programa_activo) rechaza los programas inactivos.
 */
export const getProgramasActivos = () =>
  getProgramas().filter(programa => programa.estado === 'activo');

/**
 * Hook React: devuelve el catálogo sincronizado con la BD.
 * @returns {{programas: Array, activos: Array, cargando: boolean, recargar: Function}}
 */
export function useProgramas() {
  const [programas, setProgramas] = useState(() => getProgramas());
  const [cargando, setCargando] = useState(() => cache === null);

  useEffect(() => {
    const cancelar = suscribirProgramas((lista) => {
      setProgramas(lista);
      setCargando(false);
    });
    // Dispara la descarga (deduplicada entre componentes).
    cargarProgramas();
    return cancelar;
  }, []);

  const activos = programas.filter(programa => programa.estado === 'activo');

  return {
    programas,
    activos,
    cargando,
    recargar: () => cargarProgramas({ fuerza: true }),
  };
}
