import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request Interceptor: attach JWT auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('shiftboard_token');
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
      // If unauthorized and not already on auth endpoints, clear token
      if (!error.config.url.includes('/auth/login') && !error.config.url.includes('/auth/register')) {
        localStorage.removeItem('shiftboard_token');
        localStorage.removeItem('shiftboard_user');
        window.dispatchEvent(new Event('shiftboard_auth_logout'));
      }
    }
    return Promise.reject(error);
  }
);

export default api;
