'use client';

/**
 * Estado da sessão do fã — por enquanto local/mock.
 *
 * Quando o backend entrar, `nickname`/`level`/`xp`/`streak` passam a vir do
 * GET /api/state e o `authMethod` sai do PrivyIsland. A FORMA aqui já é a do
 * contrato do v0 de propósito: quem trocar o mock pelo fetch não mexe nas telas.
 *
 * Regra do CONTEXT.md §4: o apelido NUNCA sai do e-mail — ele é público
 * (ranking/ligas) e derivá-lo do e-mail vaza o endereço da pessoa. Por isso
 * `nickname` começa vazio no cadastro novo e o onboarding pergunta.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { usePrivyAuth } from '@/components/privy/PrivyIsland';

/** As duas primeiras cumprem "sign up through Solana"; `demo` é a conta de teste da §5.1. */
export type AuthMethod = 'google' | 'wallet' | 'demo';
export type AccountType = 'new' | 'existing';
export type PlanId = 'anual' | 'mensal';
export type PayMethodId = 'card' | 'pix' | 'wallet';

export interface SessionState {
  authMethod: AuthMethod;
  accountType: AccountType;
  nickname: string;
  favTeam: string | null;
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

/** A conta de teste do modo demo — o mesmo perfil do protótipo. */
const DEMO_ACCOUNT = { nickname: 'você.craque', level: 7, xp: 1240, streak: 5 } as const;

const BASE: Omit<SessionState, 'authMethod' | 'accountType'> = {
  nickname: '',
  favTeam: null,
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

/** Sair não pode depender de uma promise da Privy que talvez nunca settle (E14). */
const LOGOUT_TIMEOUT_MS = 10_000;

interface SessionValue {
  session: SessionState | null;
  /** false até o primeiro efeito rodar — evita divergência de hidratação. */
  hydrated: boolean;
  /** Modo demo: entra na hora, conta pronta, sem carteira (regra §5.1 do hackathon). */
  enterDemo: () => void;
  /** Google/carteira: conta nova, vai pro onboarding escolher o apelido. */
  startOnboarding: (method: Exclude<AuthMethod, 'demo'>) => void;
  update: (patch: Partial<SessionState>) => void;
  /**
   * Sai de verdade: derruba a sessão do app E a da Privy. Espere a promise
   * ANTES de navegar — ver o porquê em `logout`, abaixo.
   */
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [session, setSession] = useState<SessionState | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // sessionStorage só depois de montar: ler no render divergiria do HTML do servidor.
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (raw) setSession(JSON.parse(raw) as SessionState);
    } catch {
      // storage bloqueado (aba privada) — segue sem sessão, o login resolve.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (session) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      else window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // idem: persistir é conveniência, não requisito.
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

  const update = useCallback((patch: Partial<SessionState>) => {
    setSession((s) => (s ? { ...s, ...patch } : s));
  }, []);

  /**
   * Limpar só o estado local NÃO desloga ninguém: a Privy continua autenticada,
   * o login (page.tsx) vê `authenticated` no mount seguinte e devolve o fã
   * direto pro onboarding — com o apelido zerado. Quem entrou por Google ou
   * carteira ficava sem conseguir sair, a não ser limpando os dados do site.
   *
   * O demo escapava porque nunca autentica na Privy — e é exatamente por isso
   * que o furo sobreviveu: o caminho ensaiado (§5.1) é o único que não passa por
   * aqui.
   *
   * A ordem importa: a Privy tem que cair ANTES de navegar, senão o efeito do
   * login ainda lê `authenticated: true` e o loop volta. Por isso é async e por
   * isso quem chama precisa dar await antes do router.replace('/').
   */
  const privy = usePrivyAuth();
  const logout = useCallback(async () => {
    // A Privy cai PRIMEIRO; a sessão local só depois. A ordem inversa parece
    // inofensiva e não é: `setSession(null)` acorda o guard (useRequireSession)
    // na hora, que navega pra '/' enquanto a Privy AINDA está autenticada — e o
    // login, vendo `authenticated`, manda o fã pro onboarding no meio do próprio
    // logout. A revogação da Privy é uma ida à rede (a SDK só derruba
    // `authenticated` depois que ela volta), então a janela é real, não teórica.
    // Enquanto a sessão local existe ninguém navega: o fã espera parado na tela
    // onde clicou.
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
      // Rede fora, ou promise que não settla: a sessão local cai no finally do
      // mesmo jeito. Sair pela metade é ruim; prender o fã num botão morto que
      // espera para sempre é pior — é a lição do E14.
    } finally {
      setSession(null);
    }
  }, [privy.enabled, privy.authenticated, privy.logout]);

  const value = useMemo<SessionValue>(
    () => ({ session, hydrated, enterDemo, startOnboarding, update, logout }),
    [session, hydrated, enterDemo, startOnboarding, update, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession precisa estar dentro de <SessionProvider>.');
  return ctx;
}

/** Iniciais do apelido pro avatar — mesma regra do protótipo. */
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

/** Progressão de nível do protótipo: base 1000, faixa de 500 XP. */
export const LEVEL_BASE = 1000;
export const LEVEL_SPAN = 500;

export function levelProgress(xp: number): { pct: number; toNext: number } {
  const into = ((xp - LEVEL_BASE) % LEVEL_SPAN + LEVEL_SPAN) % LEVEL_SPAN;
  return { pct: Math.max(0, Math.min(100, (into / LEVEL_SPAN) * 100)), toNext: LEVEL_SPAN - into };
}
