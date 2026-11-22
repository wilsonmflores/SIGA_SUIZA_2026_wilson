import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ToastProvider } from '../core/ui/ToastContext';
import { ConfirmProvider } from '../core/ui/ConfirmModal';
import { StudentMaster } from '../modules/students/StudentMaster';
import { invalidarProgramas } from '../core/api/programasStore';

// Mock useAuth
const mockUser = {
  id: 1,
  full_name: 'Super Administrador',
  is_superuser: true,
  role: 'superadmin',
  roles: ['superadmin'],
};

vi.mock('../core/auth/useAuth', () => ({
  useAuth: () => ({ user: mockUser }),
}));

vi.mock('../assets/tech-bg.jpg', () => ({ default: 'mock-tech-bg.jpg' }));

const jsonRes = (body, ok = true, status = 200) =>
  Promise.resolve({ ok, status, headers: new Headers(), json: async () => body });

describe('Catálogo de carreras en vivo (sin recargar la página)', () => {
  const originalFetch = globalThis.fetch;

  // Estado "de la BD": lo que devuelve GET /api/mod-programas-estudio/programas.
  // Simula lo que hace Gestión Académica al crear una carrera.
  let programasBD = [];

  const installFetch = () => {
    globalThis.fetch = vi.fn().mockImplementation((url) => {
      const u = String(url);
      if (u.includes('/mod-programas-estudio/programas')) return jsonRes([...programasBD]);
      if (u.includes('/estudiantes/siguiente-codigo')) return jsonRes({ codigo_estudiante: '2026-000001' });
      if (u.includes('/mod-admision/admitidos')) return jsonRes({ admitidos: [] });
      if (u.includes('/estudiantes')) return jsonRes([]);
      return jsonRes([]);
    });
  };

  const renderApp = () =>
    render(
      <ToastProvider>
        <ConfirmProvider>
          <StudentMaster />
        </ConfirmProvider>
      </ToastProvider>
    );

  const abrirDesplegableCarrera = () => {
    fireEvent.click(screen.getByLabelText('Mostrar opciones de Carrera / Programa de Estudios'));
  };

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('1. Una carrera creada en Gestión Académica aparece en el wizard sin F5', async () => {
    // La BD solo tiene una carrera (la que existe tras el reset)
    programasBD = [{ id: 3, nombre: 'Gestión Administrativa', estado: 'activo' }];
    installFetch();
    await invalidarProgramas(); // la caché del store parte del estado real de la BD

    renderApp();

    // Abrir el wizard de registro
    fireEvent.click(await screen.findByRole('button', { name: /Registrar Estudiante/i }));

    // El desplegable de carrera debe ofrecer la única carrera real de la BD
    abrirDesplegableCarrera();
    expect(screen.getByRole('option', { name: /Gestión Administrativa/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Construcción Civil/i })).not.toBeInTheDocument();

    // El usuario escribe en otro campo: sirve para comprobar que el wizard
    // NO se desmonta ni se recarga la página después del cambio.
    fireEvent.change(screen.getByPlaceholderText('Nombres completos'), { target: { value: 'María' } });

    // ---- GESTIÓN ACADÉMICA CREA OTRA CARRERA ----
    // Mismo efecto que handleCreateProgram/handleDeleteProgram: el store se
    // invalida y todos los suscriptores se repintan solos.
    programasBD = [
      { id: 3, nombre: 'Gestión Administrativa', estado: 'activo' },
      { id: 4, nombre: 'Construcción Civil', estado: 'activo' },
    ];
    await invalidarProgramas();

    // Sin volver a montar el componente ni recargar: la carrera nueva ya está.
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Construcción Civil/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('option', { name: /Gestión Administrativa/i })).toBeInTheDocument();

    // El wizard sigue vivo con lo que el usuario había escrito (no hubo F5)
    expect(screen.getByPlaceholderText('Nombres completos')).toHaveValue('María');
    expect(screen.getByText('Paso 1 de 5')).toBeInTheDocument();
  });

  it('2. Al eliminar una carrera desaparece del desplegable sin F5', async () => {
    programasBD = [
      { id: 3, nombre: 'Gestión Administrativa', estado: 'activo' },
      { id: 4, nombre: 'Construcción Civil', estado: 'activo' },
    ];
    installFetch();
    await invalidarProgramas(); // la caché del store parte del estado real de la BD

    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: /Registrar Estudiante/i }));
    abrirDesplegableCarrera();
    expect(screen.getByRole('option', { name: /Construcción Civil/i })).toBeInTheDocument();

    // Gestión Académica elimina la carrera
    programasBD = [{ id: 3, nombre: 'Gestión Administrativa', estado: 'activo' }];
    await invalidarProgramas();

    await waitFor(() => {
      expect(screen.queryByRole('option', { name: /Construcción Civil/i })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('option', { name: /Gestión Administrativa/i })).toBeInTheDocument();
  });

  it('3. En producción (Vercel) el store llama a VITE_API_URL, no a una URL relativa', async () => {
    // En Vercel no hay proxy /api: una URL relativa caería en el rewrite de
    // SPA y devolvería el index.html en lugar del catálogo de carreras.
    vi.stubEnv('VITE_API_URL', 'https://backend-produccion.up.railway.app');
    vi.resetModules();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => [],
    });
    globalThis.fetch = fetchMock;

    try {
      const store = await import('../core/api/programasStore');
      await store.cargarProgramas({ fuerza: true });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://backend-produccion.up.railway.app/api/mod-programas-estudio/programas'
      );
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('4. Gestión Académica refresca el catálogo en cada ruta que modifica carreras', async () => {
    // Cubre las 4 rutas que cambian el catálogo: crear, editar, eliminar e
    // importar carrera. Si alguna deja de invalidar, la carrera nueva no
    // aparece en el registro hasta que se recarga la página.
    const { default: fuente } = await import('../modules/academic/AcademicDashboard.jsx?raw');
    const llamadas = fuente.match(/invalidarProgramas\(\)/g) || [];
    expect(llamadas.length).toBeGreaterThanOrEqual(4);
  });
});
