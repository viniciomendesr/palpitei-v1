'use client';

/** Session state with a server-synchronized cache and a strictly local demo mode. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePrivyAuth } from '@/components/privy/PrivyIsland';
import type { ApiStats, ApiUser } from '@/lib/api';

/** `demo` is a local account; all other methods use Privy. */
export type AuthMethod = 'google' | 'wallet' | 'demo';
export type AccountType = 'new' | 'existing';
export type PlanId = 'anual' | 'mensal';
export type PayMethodId = 'card' | 'pix' | 'wallet';

export interface SessionState {
  authMethod: AuthMethod;
  accountType: AccountType;
  nickname: string;
  level: number;
  xp: number;
  streak: number;
  leaguesCount: number;
  isPremium: boolean;
  selectedPlan: PlanId;
  payMethod: PayMethodId;
  notif: boolean;
  live: boolean;
}

/** Demo account used by the prototype flow. */
const DEMO_ACCOUNT = { nickname: 'você.craque', level: 7, xp: 1240, streak: 5 } as const;

const BASE: Omit<SessionState, 'authMethod' | 'accountType'> = {
  nickname: '',
  level: 1,
  xp: 0,
  streak: 0,
  leaguesCount: 0,
  isPremium: false,
  selectedPlan: 'anual',
  payMethod: 'card',
  notif: true,
  live: true,
};

const STORAGE_KEY = 'palpitei.session';

/** Prevents logout from blocking if the Privy promise never settles. */
const LOGOUT_TIMEOUT_MS = 10_000;

interface SessionValue {
  session: SessionState | null;
  /** False until the first effect runs, preventing a hydration mismatch. */
  hydrated: boolean;
  /** Enters local demo mode without a wallet. */
  enterDemo: () => void;
  /** Starts onboarding for a new authenticated account. */
  startOnboarding: (method: Exclude<AuthMethod, 'demo'>) => void;
  /** Hydrates an existing account from the authoritative login response. */
  enterExisting: (method: Exclude<AuthMethod, 'demo'>, user: ApiUser) => void;
  update: (patch: Partial<SessionState>) => void;
  /** Mirrors engine-awarded XP in the cache until the next synchronization. */
  addXp: (amount: number) => void;
  /** Synchronizes the cache with `/api/state`; demo and bearerless sessions are no-ops. */
  refreshState: () => Promise<void>;
  /** Prediction accuracy from the latest refresh. */
  serverStats: ApiStats | null;
  /** Closes local and Privy sessions before navigation. */
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [session, setSession] = useState<SessionState | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [serverStats, setServerStats] = useState<ApiStats | null>(null);
  /** One synchronization is sufficient because refresh is idempotent. */
  const sincronizando = useRef(false);

  // Read sessionStorage only after mount to preserve hydration.
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        // Remove a legacy preference no longer used by the product.
        const stored = JSON.parse(raw) as SessionState & { favTeam?: unknown };
        const { favTeam: _legacyFavTeam, ...rest } = stored;
        setSession(rest);
      }
    } catch {
      // Storage is optional; authentication can still proceed.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (session) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      else window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Persistence is a convenience, not a requirement.
    }
  }, [session, hydrated]);

  const enterDemo = useCallback(() => {
    setSession({
      ...BASE,
      authMethod: 'demo',
      accountType: 'existing',
      ...DEMO_ACCOUNT,
      leaguesCount: 1,
    });
  }, []);

  const startOnboarding = useCallback((method: Exclude<AuthMethod, 'demo'>) => {
    setSession({ ...BASE, authMethod: method, accountType: 'new' });
  }, []);

  const enterExisting = useCallback((method: Exclude<AuthMethod, 'demo'>, user: ApiUser) => {
    setSession({
      ...BASE,
      authMethod: method,
      accountType: 'existing',
      nickname: user.nickname ?? '',
      level: user.level,
      xp: user.xp,
      streak: user.streak,
    });
  }, []);

  const update = useCallback((patch: Partial<SessionState>) => {
    setSession((s) => (s ? { ...s, ...patch } : s));
  }, []);

  const addXp = useCallback((amount: number) => {
    setSession((s) => (s ? { ...s, xp: s.xp + amount } : s));
  }, []);

  // Privy must sign out before local state is cleared to avoid an auth redirect loop.
  const privy = usePrivyAuth();

  const refreshState = useCallback(async () => {
    // A ready, authenticated Privy session is required to provide a bearer.
    if (!privy.enabled || !privy.ready || !privy.authenticated) return;
    if (sincronizando.current) return;
    sincronizando.current = true;
    try {
      const { api } = await import('@/lib/api');
      const estado = await api.state();
      setServerStats(estado.stats);
      setSession((atual) => {
        if (!atual || atual.authMethod === 'demo') return atual;
        return {
          ...atual,
          nickname: estado.user.nickname ?? '',
          level: estado.user.level,
          xp: estado.user.xp,
          streak: estado.user.streak,
          leaguesCount: estado.leaguesCount,
          isPremium: estado.isPremium,
        };
      });
    } catch {
      // Keep the local cache on transient network or authorization failures.
    } finally {
      sincronizando.current = false;
    }
  }, [privy.enabled, privy.ready, privy.authenticated]);

  // Reconcile persisted account state after authentication is ready.
  useEffect(() => {
    if (!hydrated || !session || session.authMethod === 'demo') return;
    void refreshState();
    // Depend on auth method rather than the full session to avoid a refresh loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, session?.authMethod, refreshState]);

  const logout = useCallback(async () => {
    // Revoke Privy first, then clear local state, to avoid an auth redirect loop.
    try {
      if (privy.enabled && privy.authenticated) {
        await Promise.race([
          privy.logout(),
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error('a Privy não respondeu ao logout')), LOGOUT_TIMEOUT_MS),
          ),
        ]);
      }
    } catch {
      // Local state is still cleared when the network or logout promise fails.
    } finally {
      setSession(null);
    }
  }, [privy.enabled, privy.authenticated, privy.logout]);

  const value = useMemo<SessionValue>(
    () => ({
      session,
      hydrated,
      enterDemo,
      startOnboarding,
      enterExisting,
      update,
      addXp,
      refreshState,
      serverStats,
      logout,
    }),
    [
      session,
      hydrated,
      enterDemo,
      startOnboarding,
      enterExisting,
      update,
      addXp,
      refreshState,
      serverStats,
      logout,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession precisa estar dentro de <SessionProvider>.');
  return ctx;
}

/** Avatar initials, matching the prototype rule. */
export function initialsOf(nickname: string, accountType: AccountType): string {
  const parts = (nickname || '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();
  return parts || (accountType === 'new' ? 'P!' : '?');
}

/** Prototype level progression: 1,000 base XP and 500-XP bands. */
export const LEVEL_BASE = 1000;
export const LEVEL_SPAN = 500;

export function levelProgress(xp: number): { pct: number; toNext: number } {
  const into = ((xp - LEVEL_BASE) % LEVEL_SPAN + LEVEL_SPAN) % LEVEL_SPAN;
  return { pct: Math.max(0, Math.min(100, (into / LEVEL_SPAN) * 100)), toNext: LEVEL_SPAN - into };
}
