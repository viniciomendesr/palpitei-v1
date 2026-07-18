'use client';


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
import type { WalletWithMetadata } from '@privy-io/react-auth';
import { PrivyProvider, usePrivy, useLogin } from '@privy-io/react-auth';
import {
  useExportWallet as useExportSolanaWallet,
  toSolanaWalletConnectors,
} from '@privy-io/react-auth/solana';
import { setAuthTokenProvider } from '@/lib/api';

export interface PrivyWallet {
  address: string;
  source: 'privy_embedded' | 'external';
}

export interface PrivyProfile {
  name: string | null;
  email: string | null;
}

export interface PrivyAuth {
  ready: boolean;
  authenticated: boolean;
  did: string | null;
  profile: PrivyProfile;
  wallets: PrivyWallet[];
  stuck: boolean;
  enabled: boolean;
  getAccessToken: () => Promise<string | null>;
  loginWithGoogle: () => Promise<void>;
  loginWithWallet: () => Promise<void>;
  logout: () => Promise<void>;
  exportWallet: () => Promise<void>;
  tambemNoPhantom: boolean;
}

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '';

const READY_TIMEOUT_MS = 8_000;
// Do not leave the app silently unavailable when Privy never becomes ready.
const EXPORT_TIMEOUT_MS = 20_000;

const desligada: PrivyAuth = {
  ready: true,
  authenticated: false,
  did: null,
  profile: { name: null, email: null },
  wallets: [],
  stuck: false,
  enabled: false,
  tambemNoPhantom: false,
  getAccessToken: async () => null,
  loginWithGoogle: async () => {
    throw new Error('Privy desligada: falta NEXT_PUBLIC_PRIVY_APP_ID.');
  },
  loginWithWallet: async () => {
    throw new Error('Privy desligada: falta NEXT_PUBLIC_PRIVY_APP_ID.');
  },
  logout: async () => {},
  exportWallet: async () => {
    throw new Error('Privy desligada: falta NEXT_PUBLIC_PRIVY_APP_ID.');
  },
};

const PrivyContext = createContext<PrivyAuth>(desligada);

function carteirasSolana(user: ReturnType<typeof usePrivy>['user']): {
  embedded: WalletWithMetadata | null;
  externas: WalletWithMetadata[];
  tambemNoPhantom: boolean;
} {
  const solanas = (user?.linkedAccounts ?? []).filter(
    (a): a is WalletWithMetadata => a.type === 'wallet' && a.chainType === 'solana',
  );
  const embedded = solanas.find((w) => w.walletClientType === 'privy') ?? null;

  const externas = solanas.filter(
    (w) => w.walletClientType !== 'privy' && w.address !== embedded?.address,
  );
  const tambemNoPhantom =
    !!embedded &&
    solanas.some((w) => w.walletClientType !== 'privy' && w.address === embedded.address);

  return { embedded, externas, tambemNoPhantom };
}

function perfilDaConta(user: ReturnType<typeof usePrivy>['user']): PrivyProfile {
  const contas = user?.linkedAccounts ?? [];
  const google = contas.find((account) => account.type === 'google_oauth');
  const email = contas.find((account) => account.type === 'email');

  return {
    name: google?.name ?? null,
    email: google?.email ?? email?.address ?? null,
  };
}

function Ponte({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, getAccessToken, logout } = usePrivy();
  const { login } = useLogin();
  const { exportWallet: exportSolana } = useExportSolanaWallet();
  const [stuck, setStuck] = useState(false);

  const { embedded, externas, tambemNoPhantom } = carteirasSolana(user);
  const profile = perfilDaConta(user);

  const readyRef = useRef(false);
  useEffect(() => {
    if (ready) readyRef.current = true;
  }, [ready]);
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (!readyRef.current) {
        setStuck(true);
        console.error(
          '[palpitei] A Privy não inicializou em 8s e não emitiu erro. ' +
            'Quase sempre é a origem não liberada em Allowed origins. Confira a config REAL:\n' +
            `  curl -s https://auth.privy.io/api/v1/apps/${APP_ID} -H "privy-app-id: ${APP_ID}"`,
        );
      }
    }, READY_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, []);

  const authRef = useRef(authenticated);
  authRef.current = authenticated;
  const getTokenRef = useRef(getAccessToken);
  getTokenRef.current = getAccessToken;

  const tokenProvider = useCallback(async () => {
    // Refs prevent a stale Bearer token during provider mount and session changes.
    if (!authRef.current) return null;
    return getTokenRef.current();
  }, []);

  useEffect(() => {
    setAuthTokenProvider(tokenProvider);
  }, [tokenProvider]);

  const doExport = useCallback(async () => {
    if (!embedded) return;
    // Privy's export modal can fail to open without settling the promise.
    await Promise.race([
      exportSolana({ address: embedded.address }),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error('o modal de export não abriu em 20s')), EXPORT_TIMEOUT_MS),
      ),
    ]);
  }, [embedded, exportSolana]);

  const value = useMemo<PrivyAuth>(
    () => ({
      ready,
      authenticated,
      did: user?.id ?? null,
      profile,
      stuck: stuck && !ready,
      enabled: true,
      tambemNoPhantom,
      wallets: [
        ...(embedded ? [{ address: embedded.address, source: 'privy_embedded' as const }] : []),
        ...externas.map((w) => ({ address: w.address, source: 'external' as const })),
      ],
      getAccessToken: tokenProvider,
      loginWithGoogle: async () => {
        login({ loginMethods: ['google', 'email'] });
      },
      loginWithWallet: async () => {
        login({ loginMethods: ['wallet'], walletChainType: 'solana-only' });
      },
      logout,
      exportWallet: doExport,
    }),
    [
      ready,
      authenticated,
      user?.id,
      profile.name,
      profile.email,
      stuck,
      tambemNoPhantom,
      embedded?.address,
      externas.map((w) => w.address).join('|'),
      tokenProvider,
      login,
      logout,
      doExport,
    ],
  );

  return <PrivyContext.Provider value={value}>{children}</PrivyContext.Provider>;
}

export function PrivyIsland({ children }: { children: ReactNode }) {
  if (!APP_ID) {
    return <PrivyContext.Provider value={desligada}>{children}</PrivyContext.Provider>;
  }

  const canUseEmbeddedWallet = typeof window === 'undefined' || window.isSecureContext;

  return (
    <PrivyProvider
      appId={APP_ID}
      config={{
        loginMethods: ['google', 'email', 'wallet'],
        appearance: {
          theme: 'dark',
          accentColor: '#C8F13F', // --lime
          walletChainType: 'solana-only',
          walletList: ['phantom', 'solflare', 'backpack', 'detected_solana_wallets'],
        },
        ...(canUseEmbeddedWallet
          // Do not create an embedded wallet for users who already have one.
          ? { embeddedWallets: { solana: { createOnLogin: 'users-without-wallets' as const } } }
          : {}),
        externalWallets: { solana: { connectors: toSolanaWalletConnectors() } },
      }}
    >
      <Ponte>{children}</Ponte>
    </PrivyProvider>
  );
}

export function usePrivyAuth(): PrivyAuth {
  return useContext(PrivyContext);
}
