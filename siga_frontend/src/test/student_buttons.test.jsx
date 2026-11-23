import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ToastProvider } from '../core/ui/ToastContext';
import { ConfirmProvider } from '../core/ui/ConfirmModal';
import { StudentMaster } from '../modules/students/StudentMaster';

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

const student = {
  id: 101,
  nombres: 'Carlos',
  apellidos: 'Pérez Gómez',
  dni: '71234567',
  codigo_estudiante: '2026-71234567',
  programa_id: 1,
  estado_academico: 'regular',
  email_personal: 'carlos@siga.edu',
  fecha_nacimiento: '2000-01-01',
  genero: 'Masculino',
  celular: '999888777',
};

const jsonRes = (body, ok = true, status = 200) =>
  Promise.resolve({ ok, status, headers: new Headers(), json: async () => body });

describe('Botones del Registro de Estudiantes (Ver / Editar / Sincronizar)', () => {
  const originalFetch = globalThis.fetch;
  let calls = [];

  const installFetch = ({ admitidos = [], ingestaError = null, ingestaResult = null } = {}) => {
    calls = [];
    globalThis.fetch = vi.fn().mockImplementation((url, opts = {}) => {
      const u = String(url);
      const method = String(opts.method || 'GET').toUpperCase();
      calls.push({ u, method });

      if (method === 'PUT' && u.includes('/estudiantes/101')) {
        return jsonRes({ ...student, apellidos: 'Pérez Editado' });
      }
      if (method === 'POST' && u.includes('/admision/ingesta')) {
        if (ingestaError) {
          // Respuesta de error real: trae `text()` (como el fetch auténtico)
          return Promise.resolve({
            ok: false,
            status: ingestaError.status,
            headers: new Headers(),
            json: async () => JSON.parse(ingestaError.body),
            text: async () => ingestaError.body,
          });
        }
        if (ingestaResult) return jsonRes(ingestaResult);
        return jsonRes({ message: 'Ingesta procesada', estudiantes_creados: 0, omitidos: 0, carreras_pendientes: {} });
      }
      if (u.includes('/mod-admision/admitidos')) return jsonRes({ admitidos });
      if (u.includes('/estudiantes/101')) return jsonRes(student); // detalle de la ficha
      if (u.includes('/estudiantes')) return jsonRes([student]);    // lista de la tabla
      if (u.includes('/mod-programas-estudio/programas')) return jsonRes([]);
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

  beforeEach(() => {
    localStorage.setItem('token', 'fake-jwt-token');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('1. Botón "Ver Ficha" abre el expediente del estudiante', async () => {
    installFetch();
    renderApp();

    await screen.findByText('Carlos Pérez Gómez');

    fireEvent.click(screen.getByTitle('Ver Ficha Institucional y Expediente'));

    // El modal de la ficha se abre con su botón de cierre y su pestaña de expediente
    await waitFor(() => expect(screen.getByLabelText('Cerrar Ficha')).toBeInTheDocument());
    expect(screen.getByText('Expediente & Censo')).toBeInTheDocument();
  });

  it('2. Botón "Editar" abre el modal y envía el PUT al confirmar', async () => {
    installFetch();
    renderApp();

    await screen.findByText('Carlos Pérez Gómez');

    fireEvent.click(screen.getByTitle('Corregir Datos del Estudiante'));

    // Modal de edición con el bloque de datos institucionales (carrera desde el store)
    await screen.findByText('Edición de Datos Personales');
    expect(screen.getByText('Datos Institucionales Asignados')).toBeInTheDocument();

    // "Guardar Cambios" está asociado al formulario por `form="edit-student-personal-form"`
    const saveBtn = screen.getByRole('button', { name: /Guardar Cambios/i });
    const form = saveBtn.form || document.getElementById('edit-student-personal-form');
    expect(form).toBeTruthy();
    fireEvent.submit(form);

    // Modal de confirmación propio del editor
    await screen.findByText('Confirmar Modificación');
    fireEvent.click(screen.getByRole('button', { name: /Sí, Confirmar/i }));

    await waitFor(() => {
      expect(calls.some(c => c.method === 'PUT' && c.u.includes('/estudiantes/101'))).toBe(true);
    });
    await waitFor(() => expect(screen.queryByText('Confirmar Modificación')).not.toBeInTheDocument());
  });

  it('3. Botón "Sincronizar desde Admisión" consulta admitidos y avisa si no hay', async () => {
    installFetch({ admitidos: [] });
    renderApp();

    await screen.findByText('Carlos Pérez Gómez');

    fireEvent.click(screen.getByRole('button', { name: /Sincronizar desde Admisión/i }));

    // Confirmación institucional antes de sincronizar
    await screen.findByTestId('confirm-modal');
    fireEvent.click(screen.getByTestId('confirm-modal-ok'));

    await waitFor(() =>
      expect(calls.some(c => c.u.includes('/mod-admision/admitidos'))).toBe(true)
    );

    // BD vacía: el botón informa que no hay ingresantes en lugar de fallar
    await screen.findByTestId('toast-info');
    expect(screen.getByText(/No se encontraron ingresantes/i)).toBeInTheDocument();
  });

  it('4. Los tres botones de acción están visibles en cada fila', async () => {
    installFetch();
    renderApp();

    await screen.findByText('Carlos Pérez Gómez');

    expect(screen.getByTitle('Ver Ficha Institucional y Expediente')).toBeInTheDocument();
    expect(screen.getByTitle('Corregir Datos del Estudiante')).toBeInTheDocument();
    expect(screen.getByTitle('Eliminar estudiante del registro')).toBeInTheDocument();
  });

  it('5. Un error 422 de la ingesta muestra el detalle legible (no el JSON crudo)', async () => {
    const detalle =
      'Carreras del archivo de admisión que no existen en el catálogo: MANEJO FORESTAL. ' +
      'Créalas en Gestión Académica Central y vuelva a sincronizar.';
    installFetch({
      admitidos: [
        { dni: '12345678', nombres: 'Ana', apellidos: 'Torres', programa_id: null, programa_nombre: 'MANEJO FORESTAL' },
      ],
      ingestaError: { status: 422, body: JSON.stringify({ detail: detalle }) },
    });
    renderApp();

    await screen.findByText('Carlos Pérez Gómez');

    fireEvent.click(screen.getByRole('button', { name: /Sincronizar desde Admisión/i }));
    await screen.findByTestId('confirm-modal');
    fireEvent.click(screen.getByTestId('confirm-modal-ok'));

    await waitFor(() =>
      expect(calls.some(c => c.method === 'POST' && c.u.includes('/admision/ingesta'))).toBe(true)
    );

    await screen.findByTestId('toast-error');
    expect(screen.getByText(new RegExp(detalle.slice(0, 60)))).toBeInTheDocument();
    // Nunca debe verse el JSON tal cual como lo devolvió el backend
    expect(screen.queryByText(/\{"detail"/)).not.toBeInTheDocument();
  });

  it('6. La ingesta parcial avisa cuántos entraron y qué carreras faltan', async () => {
    installFetch({
      admitidos: [
        { dni: '12345678', nombres: 'Ana', apellidos: 'Torres', programa_id: 1, programa_nombre: 'Gestión Administrativa' },
      ],
      ingestaResult: {
        message: 'Ingesta parcial: 74 ingresados y 707 omitidos por carreras que aún no están en el catálogo.',
        estudiantes_creados: 74,
        omitidos: 707,
        carreras_pendientes: { 'ENFERMERÍA TÉCNICA': 258, 'CONTABILIDAD': 79 },
      },
    });
    renderApp();

    await screen.findByText('Carlos Pérez Gómez');

    fireEvent.click(screen.getByRole('button', { name: /Sincronizar desde Admisión/i }));
    await screen.findByTestId('confirm-modal');
    fireEvent.click(screen.getByTestId('confirm-modal-ok'));

    await waitFor(() =>
      expect(calls.some(c => c.method === 'POST' && c.u.includes('/admision/ingesta'))).toBe(true)
    );

    await screen.findByTestId('toast-warning');
    expect(screen.getByText(/74 estudiantes ingresados y 707 omitidos/)).toBeInTheDocument();
    expect(screen.getByText(/ENFERMERÍA TÉCNICA/)).toBeInTheDocument();
    expect(screen.getByText(/vuelva a sincronizar/i)).toBeInTheDocument();
  });
});
