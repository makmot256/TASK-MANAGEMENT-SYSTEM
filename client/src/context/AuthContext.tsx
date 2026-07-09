import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { User } from '../types';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  signingOut: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => void;
  completeLogout: () => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({} as AuthCtx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);

  const loadMe = async () => {
    try {
      const { data } = await api.get('/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
      localStorage.removeItem('tms_token');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (localStorage.getItem('tms_token')) loadMe();
    else setLoading(false);
  }, []);

  const login = async (email: string, password: string) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('tms_token', data.token);
    setUser(data.user);
    setSigningOut(false);
    return data.user as User;
  };

  const logout = useCallback(() => {
    if (signingOut) return;
    setSigningOut(true);
  }, [signingOut]);

  const completeLogout = useCallback(() => {
    localStorage.removeItem('tms_token');
    setUser(null);
    setSigningOut(false);
  }, []);

  return (
    <Ctx.Provider value={{ user, loading, signingOut, login, logout, completeLogout, refresh: loadMe }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
