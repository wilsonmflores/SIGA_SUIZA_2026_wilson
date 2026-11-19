import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
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
  useAuth: () => ({
    user: mockUser,
  }),
}));

// Mock tech-bg image
vi.mock('../assets/tech-bg.jpg', () => ({
  default: 'mock-tech-bg.jpg',
}));

describe('Auditoría Registro de Estudiantes - Botón Eliminar', () => {
  const originalFetch = global.fetch;

  const mockStudents = [
    {
      id: 101,
      nombres: 'Carlos',
      apellidos: 'Pérez Gómez',
      dni: '71234567',
      codigo_estudiante: '2026-71234567',
      programa_id: 1,
      carrera: 'Desarrollo de Sistemas de Información',
      condicion: 'regular',
      estado: 'activo',
      periodo_ingreso: '2026-I',
      telefono: '999888777',
      email_institucional: 'carlos@siga.edu',
    },
  ];

  beforeEach(() => {
    localStorage.setItem('token', 'fake-jwt-token');
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('1. Debe mostrar el modal interactivo de confirmación al hacer clic en Eliminar', async () => {
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (typeof url === 'string' && url.includes('/api/mod-gestion-academica/estudiantes/')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => mockStudents,
        });
      }
      return Promise.resolve({ ok: true, status: 200, headers: new Headers(), json: async () => [] });
    });

    render(
      <ToastProvider>
        <ConfirmProvider>
          <StudentMaster />
        </ConfirmProvider>
      </ToastProvider>
    );

    // Esperar a que cargue el estudiante en la tabla
    await waitFor(() => {
      expect(screen.getByText('Carlos Pérez Gómez')).toBeInTheDocument();
    });

    // Encontrar el botón Eliminar
    const deleteBtn = screen.getByRole('button', { name: /eliminar/i });
    expect(deleteBtn).toBeInTheDocument();

    // Hacer clic en Eliminar
    fireEvent.click(deleteBtn);

    // Verificar que se abre el ConfirmModal interactivo
    await waitFor(() => {
      expect(screen.getByTestId('confirm-modal')).toBeInTheDocument();
      expect(screen.getByText('Eliminar estudiante')).toBeInTheDocument();
      expect(screen.getByText(/Se eliminará a Carlos Pérez Gómez/i)).toBeInTheDocument();
    });

    // Cancelar la eliminación
    const cancelBtn = screen.getByTestId('confirm-modal-cancel');
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(screen.queryByTestId('confirm-modal')).not.toBeInTheDocument();
    });

    // El estudiante debe seguir presente en la tabla
    expect(screen.getByText('Carlos Pérez Gómez')).toBeInTheDocument();
  });

  it('2. Debe enviar DELETE al backend al confirmar en el modal y actualizar la lista', async () => {
    let deleteCalled = false;
    let studentsPool = [...mockStudents];

    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (opts?.method === 'DELETE') {
        deleteCalled = true;
        studentsPool = [];
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ message: 'Estudiante eliminado' }),
        });
      }

      if (typeof url === 'string' && url.includes('/api/mod-gestion-academica/estudiantes/')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => studentsPool,
        });
      }
      return Promise.resolve({ ok: true, status: 200, headers: new Headers(), json: async () => [] });
    });

    render(
      <ToastProvider>
        <ConfirmProvider>
          <StudentMaster />
        </ConfirmProvider>
      </ToastProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Carlos Pérez Gómez')).toBeInTheDocument();
    });

    const deleteBtn = screen.getByRole('button', { name: /eliminar/i });
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(screen.getByTestId('confirm-modal')).toBeInTheDocument();
    });

    const okBtn = screen.getByTestId('confirm-modal-ok');
    fireEvent.click(okBtn);

    await waitFor(() => {
      expect(deleteCalled).toBe(true);
      expect(screen.getByText(/fue eliminado del registro/i)).toBeInTheDocument();
    });
  });

  it('3. Debe mostrar el mensaje 409 del backend si el estudiante conserva historial académico', async () => {
    let deleteHit = false;
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (opts?.method === 'DELETE') {
        deleteHit = true;
        return Promise.resolve({
          ok: false,
          status: 409,
          headers: new Headers(),
          json: async () => ({
            detail: 'No se puede eliminar este estudiante porque conserva historial o movimientos: matriculas (1).',
          }),
        });
      }

      if (typeof url === 'string' && url.includes('/api/mod-gestion-academica/estudiantes/')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => mockStudents,
        });
      }
      return Promise.resolve({ ok: true, status: 200, headers: new Headers(), json: async () => [] });
    });

    render(
      <ToastProvider>
        <ConfirmProvider>
          <StudentMaster />
        </ConfirmProvider>
      </ToastProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Carlos Pérez Gómez')).toBeInTheDocument();
    });

    const deleteBtn = screen.getByRole('button', { name: /eliminar/i });
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(screen.getByTestId('confirm-modal')).toBeInTheDocument();
    });

    const okBtn = screen.getByTestId('confirm-modal-ok');
    fireEvent.click(okBtn);

    await waitFor(() => {
      expect(deleteHit).toBe(true);
    });

    await waitFor(() => {
      expect(screen.getByTestId('toast-error')).toBeInTheDocument();
      expect(
        screen.getByText(/No se pudo eliminar: No se puede eliminar este estudiante/i)
      ).toBeInTheDocument();
    });

    // El estudiante no debe eliminarse de la vista si el backend falló
    expect(screen.getByText('Carlos Pérez Gómez')).toBeInTheDocument();
  });
});
