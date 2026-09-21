import axios from 'axios';

const api = axios.create({
  baseURL: '',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request Interceptor: ensure relative /api path and attach Authorization bearer token
api.interceptors.request.use(
  (config) => {
    // Route through /api proxy if not absolute URL
    if (config.url && !config.url.startsWith('http://') && !config.url.startsWith('https://')) {
      if (!config.url.startsWith('/api')) {
        config.url = `/api${config.url.startsWith('/') ? '' : '/'}${config.url}`;
      }
    }

    const token = localStorage.getItem('token') || localStorage.getItem('shiftboard_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response Interceptor: handle 401 unauthenticated
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      const url = error.config?.url || '';
      if (!url.includes('/auth/login') && !url.includes('/auth/register')) {
        localStorage.removeItem('token');
        localStorage.removeItem('shiftboard_token');
        localStorage.removeItem('user');
        localStorage.removeItem('shiftboard_user');
        window.dispatchEvent(new Event('shiftboard_auth_logout'));
      }
    }
    return Promise.reject(error);
  }
);

export default api;
