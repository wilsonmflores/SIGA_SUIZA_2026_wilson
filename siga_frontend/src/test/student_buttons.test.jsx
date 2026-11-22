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

  const installFetch = ({ admitidos = [] } = {}) => {
    calls = [];
    globalThis.fetch = vi.fn().mockImplementation((url, opts = {}) => {
      const u = String(url);
      const method = String(opts.method || 'GET').toUpperCase();
      calls.push({ u, method });

      if (method === 'PUT' && u.includes('/estudiantes/101')) {
        return jsonRes({ ...student, apellidos: 'Pérez Editado' });
      }
      if (method === 'POST' && u.includes('/admision/ingesta')) {
        return jsonRes({ message: 'Ingesta procesada', estudiantes_creados: 0 });
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
});
