import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Role } from "@/config/roles";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  societyId?: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  user: AuthUser | null;
  hasRole: (role: Role) => boolean;
  hasAnyRole: (roles: Role[]) => boolean;
  login: (user: AuthUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);

  const value = useMemo<AuthState>(
    () => ({
      isAuthenticated: !!user,
      user,
      hasRole: (role) => user?.role === role,
      hasAnyRole: (roles) => (user ? roles.includes(user.role) : false),
      login: (u) => setUser(u),
      logout: () => setUser(null),
    }),
    [user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
