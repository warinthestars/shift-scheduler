import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  // Initialize auth state from local storage on boot
  useEffect(() => {
    const savedToken = localStorage.getItem('shiftboard_token');
    const savedUser = localStorage.getItem('shiftboard_user');

    if (savedToken && savedUser) {
      try {
        setToken(savedToken);
        setUser(JSON.parse(savedUser));
        // Verify / refresh user profile in background
        api.get('/auth/me')
          .then((res) => {
            setUser(res.data);
            localStorage.setItem('shiftboard_user', JSON.stringify(res.data));
          })
          .catch(() => {
            // Token might be invalid, logout will be handled by interceptor
          })
          .finally(() => setLoading(false));
      } catch (err) {
        logout();
        setLoading(false);
      }
    } else {
      setLoading(false);
    }

    const handleLogoutEvent = () => {
      setUser(null);
      setToken(null);
    };
    window.addEventListener('shiftboard_auth_logout', handleLogoutEvent);
    return () => window.removeEventListener('shiftboard_auth_logout', handleLogoutEvent);
  }, []);

  const saveAuthSession = (accessToken, userData) => {
    setToken(accessToken);
    setUser(userData);
    localStorage.setItem('shiftboard_token', accessToken);
    localStorage.setItem('shiftboard_user', JSON.stringify(userData));
  };

  const login = async (email, password) => {
    const response = await api.post('/auth/login', { email, password });
    saveAuthSession(response.data.access_token, response.data.user);
    return response.data.user;
  };

  const loginWithGoogleMock = async () => {
    // Mock Firebase OAuth: passes dummy token to backend mock resolver
    const response = await api.post('/auth/firebase-login', {
      firebase_token: 'mock-firebase-token-123',
      email: 'demo_google_worker@shiftboard.local',
      first_name: 'Alex',
      last_name: 'Rivera'
    });
    saveAuthSession(response.data.access_token, response.data.user);
    return response.data.user;
  };

  const register = async (userData) => {
    const response = await api.post('/auth/register', userData);
    saveAuthSession(response.data.access_token, response.data.user);
    return response.data.user;
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('shiftboard_token');
    localStorage.removeItem('shiftboard_user');
  };

  const refreshProfile = async () => {
    try {
      const res = await api.get('/users/me');
      setUser(res.data);
      localStorage.setItem('shiftboard_user', JSON.stringify(res.data));
      return res.data;
    } catch (err) {
      console.error('Failed to refresh profile:', err);
    }
  };

  const normalizedRole = (user?.role || '').toUpperCase();
  const isAdmin = normalizedRole === 'SUPER_ADMIN' || normalizedRole === 'PLATFORM_ADMIN';
  const isManager = isAdmin || normalizedRole === 'VENUE_MANAGER';
  const isWorker = normalizedRole === 'WORKER';

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        login,
        loginWithGoogleMock,
        register,
        logout,
        refreshProfile,
        isAuthenticated: !!token,
        isAdmin,
        isManager,
        isWorker,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
