import React, { createContext, useContext, useState, useEffect } from 'react';
import { jwtDecode } from 'jwt-decode';
import api from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  // Parse token safely and extract user payload
  const parseTokenUser = (jwtToken, extraUserData = {}) => {
    try {
      const decoded = jwtDecode(jwtToken);
      return {
        id: decoded.sub || extraUserData.id,
        role: decoded.role || extraUserData.role || 'worker',
        venue_id: decoded.venue_id || extraUserData.venue_id || null,
        ...extraUserData,
      };
    } catch (err) {
      console.warn('Could not decode JWT:', err);
      return extraUserData;
    }
  };

  // Initialize auth state from local storage on boot
  useEffect(() => {
    const savedToken = localStorage.getItem('token') || localStorage.getItem('shiftboard_token');
    const savedUser = localStorage.getItem('user') || localStorage.getItem('shiftboard_user');

    if (savedToken) {
      try {
        setToken(savedToken);
        let parsedUser = null;
        if (savedUser) {
          try {
            parsedUser = JSON.parse(savedUser);
          } catch (e) {}
        }
        const userObj = parseTokenUser(savedToken, parsedUser || {});
        setUser(userObj);

        // Verify & fetch full profile from /api/users/me
        api.get('/users/me')
          .then((res) => {
            const updated = parseTokenUser(savedToken, res.data);
            setUser(updated);
            localStorage.setItem('user', JSON.stringify(updated));
          })
          .catch(() => {
            // Interceptor handles logout on 401
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

  const saveAuthSession = (accessToken, rawUserData = {}) => {
    setToken(accessToken);
    const decodedUser = parseTokenUser(accessToken, rawUserData);
    setUser(decodedUser);
    localStorage.setItem('token', accessToken);
    localStorage.setItem('shiftboard_token', accessToken);
    localStorage.setItem('user', JSON.stringify(decodedUser));
    localStorage.setItem('shiftboard_user', JSON.stringify(decodedUser));
    return decodedUser;
  };

  const login = async (email, password) => {
    const response = await api.post('/auth/login', { email, password });
    const { access_token, user: apiUser } = response.data;
    const userSession = saveAuthSession(access_token, apiUser);
    return userSession;
  };

  const loginWithGoogleMock = async () => {
    const response = await api.post('/auth/firebase-login', {
      firebase_token: 'mock-firebase-token-123',
      email: 'demo_google_worker@shiftboard.com',
      first_name: 'Alex',
      last_name: 'Rivera',
    });
    const { access_token, user: apiUser } = response.data;
    const userSession = saveAuthSession(access_token, apiUser);
    return userSession;
  };

  const register = async (userData) => {
    const response = await api.post('/auth/register', userData);
    const { access_token, user: apiUser } = response.data;
    const userSession = saveAuthSession(access_token, apiUser);
    return userSession;
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('token');
    localStorage.removeItem('shiftboard_token');
    localStorage.removeItem('user');
    localStorage.removeItem('shiftboard_user');
  };

  const refreshProfile = async () => {
    try {
      const res = await api.get('/users/me');
      const savedToken = localStorage.getItem('token');
      const updated = parseTokenUser(savedToken || '', res.data);
      setUser(updated);
      localStorage.setItem('user', JSON.stringify(updated));
      return updated;
    } catch (err) {
      console.error('Failed to refresh profile:', err);
    }
  };

  const userRole = (user?.role || '').toLowerCase();
  const isAdmin = userRole === 'platform_admin';
  const isManager = userRole === 'venue_manager' || isAdmin;
  const isWorker = userRole === 'worker';

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
        role: userRole,
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
