export const API_BASE = import.meta.env.VITE_API_URL || '';
export const WS_BASE = import.meta.env.VITE_WS_URL || `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`;

class SIGAApiClient {
  constructor() {
    this.baseURL = API_BASE;
    this.token = localStorage.getItem('token');
  }

  setToken(token) {
    this.token = token;
    localStorage.setItem('token', token);
  }

  clearToken() {
    this.token = null;
    localStorage.removeItem('token');
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const { timeoutMs, ...fetchOptions } = options;
    const controller = timeoutMs ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;
    // Multipart: el navegador debe calcular el boundary, no fijamos Content-Type.
    const isFormData =
      typeof FormData !== 'undefined' && fetchOptions.body instanceof FormData;
    const config = {
      headers: {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...fetchOptions.headers,
      },
      ...fetchOptions,
      ...(controller && !fetchOptions.signal ? { signal: controller.signal } : {}),
    };

    if (this.token) {
      config.headers.Authorization = `Bearer ${this.token}`;
    }

    try {
      const response = await fetch(url, config);

      if (response.status === 401) {
        if (endpoint.startsWith('/auth/login')) {
          let errorMsg = 'Credenciales inválidas';
          try {
            const errorData = await response.json();
            errorMsg = errorData.detail || errorMsg;
          } catch (_) {}
          throw new Error(errorMsg);
        }
        this.clearToken();
        window.location.reload();
        return;
      }

      if (!response.ok) {
        let errorMsg = `HTTP error! status: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMsg = errorData.detail || errorMsg;
        } catch {
          // ignore
        }
        throw new Error(errorMsg);
      }

      return await response.json();
    } catch (error) {
      console.error('API Request failed:', error);
      throw error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  // Auth endpoints
  async login(email, password) {
    return this.request(`/auth/login?email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`, {
      method: 'POST'
    });
  }

  async getCurrentUser() {
    return this.request('/auth/me', { timeoutMs: 10000 });
  }

  async register(email, password, fullName) {
    return this.request(`/auth/register?email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}&full_name=${encodeURIComponent(fullName)}`, {
      method: 'POST'
    });
  }

  // Module proxy calls
  async callModule(moduleName, endpoint, method = 'GET', data = null) {
    return this.request(`/api/${moduleName}/${endpoint}`, {
      method,
      body: data ? JSON.stringify(data) : null
    });
  }

  // Subida de archivos (multipart) a un endpoint de módulo
  async upload(moduleName, endpoint, formData) {
    return this.request(`/api/${moduleName}/${endpoint}`, {
      method: 'POST',
      body: formData,
      timeoutMs: 120000
    });
  }

  // Abre un archivo protegido del backend en una pestaña nueva.
  // El gateway exige header Authorization, por lo que un <a href> simple
  // recibiría 401: se descarga como blob con el token y se abre en objectURL.
  async openFile(fileUrl) {
    // URLs legadas (simuladas o externas): se abren directamente.
    if (!fileUrl || !fileUrl.startsWith('/api/')) {
      window.open(fileUrl, '_blank', 'noopener');
      return;
    }
    const url = `${this.baseURL}${fileUrl}`;
    const headers = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`No se pudo abrir el archivo (HTTP ${response.status}).`);
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const opened = window.open(objectUrl, '_blank', 'noopener');
    if (!opened) {
      throw new Error('El navegador bloqueó la pestaña nueva. Permita las ventanas emergentes.');
    }
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  }

  // Core system endpoints
  async getSystemStatus() {
    return this.request('/core/status');
  }

  async getModules() {
    return this.request('/core/modules');
  }
}

export const apiClient = new SIGAApiClient();

// WebSocket Client for real-time events
export class SIGAWSClient {
  constructor() {
    this.ws = null;
    this.listeners = {};
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  connect() {
    if (this.ws && this.connected) {
      setTimeout(() => this.trigger('connected'), 0);
      return;
    }

    this.ws = new WebSocket(`${WS_BASE}/ws`);

    this.ws.onopen = () => {
      console.log('✅ WebSocket connected');
      this.connected = true;
      this.reconnectAttempts = 0;
      this.trigger('connected');
    };

    this.ws.onmessage = (event) => {
      console.log('📨 WS Message:', event.data);
      this.trigger('message', event.data);
    };

    this.ws.onclose = () => {
      console.log('🔌 WebSocket disconnected');
      this.connected = false;
      this.trigger('disconnected');
      
      // Auto reconnect (if not intentionally closed)
      if (!this.intentionalDisconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        setTimeout(() => this.connect(), 2000 * this.reconnectAttempts);
      }
      this.intentionalDisconnect = false;
    };
    
    this.ws.onerror = (error) => {
      console.error('❌ WebSocket error:', error);
    };
  }

  disconnect() {
    if (this.ws) {
      this.intentionalDisconnect = true;
      this.ws.close();
      this.ws = null;
    }
  }

  send(data) {
    if (this.ws && this.connected) {
      this.ws.send(typeof data === 'string' ? data : JSON.stringify(data));
    }
  }

  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
    return () => {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    };
  }

  trigger(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(callback => callback(data));
    }
  }
}

export const wsClient = new SIGAWSClient();