import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { ROLES, type Role } from "@/config/roles";

export interface AuthProfile {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  society_id: string | null;
  phone?: string | null;
  aadhaar_verified?: boolean | null;
  aadhaar_uploaded_at?: string | null;
  theme?: string | null;
}

export interface AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: User | null;
  session: Session | null;
  profile: AuthProfile | null;
  roles: Role[];
  primaryRole: Role | null;
  hasRole: (role: Role) => boolean;
  hasAnyRole: (roles: Role[]) => boolean;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const ROLE_PRIORITY: Role[] = [
  ROLES.SUPER_ADMIN,
  ROLES.SOCIETY_ADMIN,
  ROLES.RESIDENT,
];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const loadSeq = useRef(0);

  const loadUserContext = useCallback(async (uid: string | null) => {
    if (!uid) {
      setProfile(null);
      setRoles([]);
      return;
    }
    const [{ data: profileData }, { data: roleData }] = await Promise.all([
      (supabase as any)
        .from("profiles")
        .select("id, full_name, email, avatar_url, society_id, phone, aadhaar_verified, aadhaar_uploaded_at, theme")
        .eq("id", uid)
        .maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", uid),
    ]);
    setProfile((profileData as AuthProfile) ?? null);
    setRoles(Array.from(new Set(roleData?.map((r) => r.role as Role) ?? [])) as Role[]);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function applySession(nextSession: Session | null) {
      const seq = ++loadSeq.current;
      setIsLoading(true);
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      try {
        await loadUserContext(nextSession?.user?.id ?? null);
      } finally {
        if (mounted && seq === loadSeq.current) setIsLoading(false);
      }
    }

    // 1. Subscribe FIRST (per Supabase guidance)
    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      // Defer DB calls to avoid deadlock with auth listener
      setTimeout(() => {
        void applySession(nextSession);
      }, 0);
    });

    // 2. Then read existing session
    supabase.auth.getSession().then(({ data }) => {
      void applySession(data.session);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadUserContext]);

  const value = useMemo<AuthState>(() => {
    const primaryRole =
      ROLE_PRIORITY.find((r) => roles.includes(r)) ?? null;
    return {
      isLoading,
      isAuthenticated: !!session,
      user,
      session,
      profile,
      roles,
      primaryRole,
      hasRole: (r) => roles.includes(r),
      hasAnyRole: (rs) => rs.some((r) => roles.includes(r)),
      signOut: async () => {
        await supabase.auth.signOut();
      },
      refresh: async () => {
        await loadUserContext(user?.id ?? null);
      },
    };
  }, [isLoading, session, user, profile, roles, loadUserContext]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
