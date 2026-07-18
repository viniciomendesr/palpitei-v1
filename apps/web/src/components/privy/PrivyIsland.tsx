'use client';

/** Ponte cliente da Privy: DID é a identidade; o watchdog torna falhas de boot visíveis. */

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

/** O que uma carteira Solana do fã expõe pro app. */
export interface PrivyWallet {
  address: string;
  /** 'privy_embedded' = criada pela Privy; 'external' = Phantom & cia. */
  source: 'privy_embedded' | 'external';
}

/** Dados privados de exibição fornecidos pela conta Privy no cliente. */
export interface PrivyProfile {
  name: string | null;
  email: string | null;
}

export interface PrivyAuth {
  /** false enquanto o SDK não inicializa. Use pra segurar a tela — e o watchdog. */
  ready: boolean;
  authenticated: boolean;
  /** O DID verificado. É ESTA a identidade do fã — nunca a carteira, nunca o e-mail. */
  did: string | null;
  /** Metadados para a tela de perfil; não são identidade nem vão para o banco. */
  profile: PrivyProfile;
  wallets: PrivyWallet[];
  /** true quando o SDK não subiu em 8s: origem não liberada, appId errado, rede fora. */
  stuck: boolean;
  /** false quando não há NEXT_PUBLIC_PRIVY_APP_ID — o modo demo segue funcionando. */
  enabled: boolean;
  /** O Bearer que o cliente REST anexa. null quando não há sessão. */
  getAccessToken: () => Promise<string | null>;
  loginWithGoogle: () => Promise<void>;
  loginWithWallet: () => Promise<void>;
  logout: () => Promise<void>;
  exportWallet: () => Promise<void>;
  /** Mesmo endereço registrado como embutida E como Phantom: a portabilidade funcionou. */
  tambemNoPhantom: boolean;
}

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '';

/** Expõe falha de inicialização da Privy em vez de degradar silenciosamente. */
const READY_TIMEOUT_MS = 8_000;
/** Impede que uma exportação cujo modal não abriu bloqueie a UI indefinidamente. */
const EXPORT_TIMEOUT_MS = 20_000;

/** Sem appId, preserva o modo demo sem autenticação Privy. */
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

/** Lê carteiras Solana vinculadas, distinguindo a embutida da externa. */
function carteirasSolana(user: ReturnType<typeof usePrivy>['user']): {
  embedded: WalletWithMetadata | null;
  externas: WalletWithMetadata[];
  tambemNoPhantom: boolean;
} {
  const solanas = (user?.linkedAccounts ?? []).filter(
    (a): a is WalletWithMetadata => a.type === 'wallet' && a.chainType === 'solana',
  );
  const embedded = solanas.find((w) => w.walletClientType === 'privy') ?? null;

  // O mesmo endereço pode ser embutido e externo; compare endereço para não duplicá-lo.
  const externas = solanas.filter(
    (w) => w.walletClientType !== 'privy' && w.address !== embedded?.address,
  );
  const tambemNoPhantom =
    !!embedded &&
    solanas.some((w) => w.walletClientType !== 'privy' && w.address === embedded.address);

  return { embedded, externas, tambemNoPhantom };
}

/** Nome e e-mail são privados no perfil; DID é a identidade e apelido é público. */
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

  // Watchdog para origem inválida, appId incorreto ou indisponibilidade de rede.
  const readyRef = useRef(false);
  useEffect(() => {
    if (ready) readyRef.current = true;
  }, [ready]);
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (!readyRef.current) {
        setStuck(true);
        // eslint-disable-next-line no-console
        console.error(
          '[palpitei] A Privy não inicializou em 8s e não emitiu erro. ' +
            'Quase sempre é a origem não liberada em Allowed origins. Confira a config REAL:\n' +
            `  curl -s https://auth.privy.io/api/v1/apps/${APP_ID} -H "privy-app-id: ${APP_ID}"`,
        );
      }
    }, READY_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, []);

  /** Provider estável lê refs atuais para evitar uma janela de Bearer obsoleto. */
  const authRef = useRef(authenticated);
  authRef.current = authenticated;
  const getTokenRef = useRef(getAccessToken);
  getTokenRef.current = getAccessToken;

  const tokenProvider = useCallback(async () => {
    if (!authRef.current) return null;
    return getTokenRef.current();
  }, []);

  // O cliente envia Bearer; o servidor deriva identidade apenas do DID verificado.
  useEffect(() => {
    setAuthTokenProvider(tokenProvider);
  }, [tokenProvider]);

  const doExport = useCallback(async () => {
    if (!embedded) return;
    // O timeout libera a UI se o modal de exportação não abrir.
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
      // Um watchdog anterior não permanece ativo após a SDK ficar pronta.
      stuck: stuck && !ready,
      enabled: true,
      tambemNoPhantom,
      wallets: [
        ...(embedded ? [{ address: embedded.address, source: 'privy_embedded' as const }] : []),
        ...externas.map((w) => ({ address: w.address, source: 'external' as const })),
      ],
      getAccessToken: tokenProvider,
      // Login social pode provisionar a carteira Solana embutida.
      loginWithGoogle: async () => {
        login({ loginMethods: ['google', 'email'] });
      },
      // Login por carteira usa conectores Solana no desktop e mobile.
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
  // Sem appId, o modo demo continua disponível.
  if (!APP_ID) {
    return <PrivyContext.Provider value={desligada}>{children}</PrivyContext.Provider>;
  }

  // Carteira embutida exige contexto seguro fora de localhost.
  const canUseEmbeddedWallet = typeof window === 'undefined' || window.isSecureContext;

  return (
    <PrivyProvider
      appId={APP_ID}
      config={{
        // Apple não está configurado para esta integração.
        loginMethods: ['google', 'email', 'wallet'],
        appearance: {
          theme: 'dark',
          accentColor: '#C8F13F', // --lime
          walletChainType: 'solana-only',
          // Phantom é priorizada; extensões Solana detectadas continuam disponíveis.
          walletList: ['phantom', 'solflare', 'backpack', 'detected_solana_wallets'],
        },
        // Não use `all-users`: só usuários sem carteira recebem uma embutida.
        ...(canUseEmbeddedWallet
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
