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

export interface AuthSociety {
  society_id: string;
  society_name: string;
  roles: string[];
  is_current: boolean;
  tenancy_ends_on: string | null;
}

export interface AuthState {
  isLoading: boolean;
  isCheckingProfile: boolean;
  isAuthenticated: boolean;
  user: User | null;
  session: Session | null;
  profile: AuthProfile | null;
  roles: Role[];
  primaryRole: Role | null;
  societies: AuthSociety[];
  switchSociety: (societyId: string) => Promise<void>;
  hasRole: (role: Role) => boolean;
  hasAnyRole: (roles: Role[]) => boolean;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const ROLE_PRIORITY: Role[] = [
  ROLES.SUPER_ADMIN,
  ROLES.SOCIETY_ADMIN,
  ROLES.BLOCK_ADMIN,
  ROLES.SECURITY,
  ROLES.RESIDENT,
];

function isKnownRole(role: unknown): role is Role {
  return Object.values(ROLES).includes(role as Role);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [societies, setSocieties] = useState<AuthSociety[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const loadSeq = useRef(0);
  const loadedUserId = useRef<string | null>(null);

  const loadUserContext = useCallback(async (nextUser: User | null) => {
    if (!nextUser) {
      return { profile: null, roles: [] as Role[], societies: [] as AuthSociety[] };
    }

    const uid = nextUser.id;

    const { data: rpcContext, error: rpcError } = await (supabase as any)
      .rpc("get_current_auth_context")
      .maybeSingle();

    if (!rpcError && rpcContext) {
      const roleRows = Array.isArray(rpcContext.roles) ? rpcContext.roles : [];
      const resolvedRoles = Array.from(
        new Set(roleRows.map((r: any) => r.role).filter(isKnownRole)),
      ) as Role[];
      const profileData = (rpcContext.profile as AuthProfile | null) ?? null;
      const resolvedProfile: AuthProfile = profileData
        ? { ...profileData, society_id: (rpcContext.society_id as string | null) ?? profileData.society_id ?? null }
        : {
            id: uid,
            full_name: (nextUser.user_metadata?.full_name as string | undefined) ?? null,
            email: nextUser.email ?? null,
            avatar_url: (nextUser.user_metadata?.avatar_url as string | undefined) ?? null,
            society_id: (rpcContext.society_id as string | null) ?? null,
            phone: nextUser.phone ?? null,
            aadhaar_verified: null,
            aadhaar_uploaded_at: null,
            theme: null,
          };
      const { data: societyRows } = await supabase.rpc("list_my_societies");
      return { profile: resolvedProfile, roles: resolvedRoles, societies: (societyRows ?? []) as AuthSociety[] };
    }

    if (rpcError) {
      console.error("Failed to load auth context", rpcError);
    }

    const [profileResult, roleResult] = await Promise.all([
      (supabase as any)
        .from("profiles")
        .select("id, full_name, email, avatar_url, society_id, phone, aadhaar_verified, aadhaar_uploaded_at, theme")
        .eq("id", uid)
        .maybeSingle(),
      supabase.from("user_roles").select("role, society_id").eq("user_id", uid).eq("is_active", true),
    ]);

    let profileData = profileResult.data as AuthProfile | null;

    // Safety fallback: if Supabase's schema cache is briefly stale after a migration,
    // never treat an existing user as society-less. Load only stable columns instead.
    if (profileResult.error) {
      console.error("Failed to load full profile", profileResult.error);
      const { data: fallbackProfile, error: fallbackError } = await (supabase as any)
        .from("profiles")
        .select("id, full_name, email, avatar_url, society_id, phone")
        .eq("id", uid)
        .maybeSingle();
      if (fallbackError) console.error("Failed to load fallback profile", fallbackError);
      profileData = (fallbackProfile as AuthProfile | null) ?? null;
    }

    if (roleResult.error) {
      console.error("Failed to load roles", roleResult.error);
    }

    const activeSocietyId = profileData?.society_id ?? null;
    const roleRows = (roleResult.data ?? []).filter(
      (row) => row.role === ROLES.SUPER_ADMIN || (activeSocietyId !== null && row.society_id === activeSocietyId),
    );
    const resolvedRoles = Array.from(new Set(roleRows.map((r) => r.role).filter(isKnownRole))) as Role[];
    const societyIdFromRole = activeSocietyId;
    const resolvedProfile: AuthProfile = profileData
      ? { ...profileData, society_id: profileData.society_id ?? societyIdFromRole }
      : {
          id: uid,
          full_name: (nextUser.user_metadata?.full_name as string | undefined) ?? null,
          email: nextUser.email ?? null,
          avatar_url: (nextUser.user_metadata?.avatar_url as string | undefined) ?? null,
          society_id: societyIdFromRole,
          phone: nextUser.phone ?? null,
          aadhaar_verified: null,
          aadhaar_uploaded_at: null,
          theme: null,
        };

    const { data: societyRows } = await supabase.rpc("list_my_societies");
    return { profile: resolvedProfile, roles: resolvedRoles, societies: (societyRows ?? []) as AuthSociety[] };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function applySession(nextSession: Session | null) {
      const seq = ++loadSeq.current;
      loadedUserId.current = nextSession?.user.id ?? null;
      setIsLoading(true);
      try {
        const nextUser = nextSession?.user ?? null;
        const nextContext = await loadUserContext(nextUser);
        if (mounted && seq === loadSeq.current) {
          setSession(nextSession);
          setUser(nextUser);
          setProfile(nextContext.profile);
          setRoles(nextContext.roles);
          setSocieties(nextContext.societies);
        }
      } finally {
        if (mounted && seq === loadSeq.current) setIsLoading(false);
      }
    }

    // 1. Subscribe FIRST (per Supabase guidance)
    const { data: sub } = supabase.auth.onAuthStateChange((event, nextSession) => {
      // getSession() below already loads the initial context; a token refresh keeps the same
      // user, so only swap the session instead of re-fetching roles/societies (was 3x per load).
      if (event === "INITIAL_SESSION") return;
      // supabase-js also emits SIGNED_IN for an already-restored session; same user → no reload.
      if (
        event === "TOKEN_REFRESHED" ||
        (event === "SIGNED_IN" && nextSession?.user.id && nextSession.user.id === loadedUserId.current)
      ) {
        if (mounted) setSession(nextSession);
        return;
      }
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
      isCheckingProfile: isLoading,
      isAuthenticated: !!session,
      user,
      session,
      profile,
      roles,
      primaryRole,
      societies,
      switchSociety: async (societyId) => {
        const { error } = await supabase.rpc("switch_active_society", { _society_id: societyId });
        if (error) throw error;
        const seq = ++loadSeq.current;
        const nextContext = await loadUserContext(user);
        if (seq === loadSeq.current) {
          setProfile(nextContext.profile);
          setRoles(nextContext.roles);
          setSocieties(nextContext.societies);
        }
      },
      hasRole: (r) => roles.includes(r),
      hasAnyRole: (rs) => rs.some((r) => roles.includes(r)),
      signOut: async () => {
        loadSeq.current += 1;
        setIsLoading(true);
        setSession(null);
        setUser(null);
        setProfile(null);
        setRoles([]);
        setSocieties([]);
        await supabase.auth.signOut();
        setIsLoading(false);
      },
      refresh: async () => {
        const seq = ++loadSeq.current;
        setIsLoading(true);
        try {
          const nextContext = await loadUserContext(user);
          if (seq === loadSeq.current) {
            setProfile(nextContext.profile);
            setRoles(nextContext.roles);
              setSocieties(nextContext.societies);
          }
        } finally {
          if (seq === loadSeq.current) setIsLoading(false);
        }
      },
    };
  }, [isLoading, session, user, profile, roles, societies, loadUserContext]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
