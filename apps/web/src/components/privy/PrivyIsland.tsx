'use client';

/**
 * Ilha da Privy — portada de ../../palpitei-v0/web/privy-island.tsx, que é o
 * resultado de 14 achados (E1..E16). O que está aqui NÃO é escolha de estilo:
 * cada linha comentada abaixo custou horas na bancada e falha em SILÊNCIO.
 *
 * A app de produção (cmrnum7sz00ft0cjruc4dtkj2) foi verificada em 16/07 pela
 * config real — não pelo painel, que mente sobre estado salvo:
 *   curl -s https://auth.privy.io/api/v1/apps/$APP_ID -H "privy-app-id: $APP_ID"
 *   google_oauth: true · solana_wallet_auth: true
 *   embedded_wallet_config.solana.create_on_login: "users-without-wallets"
 *   allowed_domains: inclui localhost, dev mobile HTTPS e domínio de produção
 *   dev mobile com embedded wallet: use HTTPS e adicione "https://<ip-do-mac>:3000"
 *
 * ⚠ Antes do deploy: pôr o domínio de produção em Allowed origins. Sem isso o
 *   PrivyProvider renderiza null, SEM erro e SEM log — tela branca e muda para o
 *   jurado (E7). É por isso que o watchdog abaixo existe.
 */

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

/** O PrivyProvider que não inicializa fica calado para sempre (E7). Este é o prazo. */
const READY_TIMEOUT_MS = 8_000;
/** A promise do exportWallet() só settla quando o usuário FECHA o modal (E14). */
const EXPORT_TIMEOUT_MS = 20_000;

/** Sem appId: a ilha não sobe, mas o modo demo (§5.1) não depende dela. */
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

/**
 * Carteiras Solana lidas das linked accounts — a MESMA fonte e o MESMO filtro que
 * o servidor usa, de propósito. `useWallets()` do /solana devolve carteiras
 * CONECTADAS, que não expõem walletClientType e por isso não distinguem a
 * embutida da externa (E3).
 */
function carteirasSolana(user: ReturnType<typeof usePrivy>['user']): {
  embedded: WalletWithMetadata | null;
  externas: WalletWithMetadata[];
  tambemNoPhantom: boolean;
} {
  const solanas = (user?.linkedAccounts ?? []).filter(
    (a): a is WalletWithMetadata => a.type === 'wallet' && a.chainType === 'solana',
  );
  const embedded = solanas.find((w) => w.walletClientType === 'privy') ?? null;

  // O MESMO endereço pode estar registrado DUAS vezes: como embutida e como
  // externa, quando o fã exporta a chave, importa no Phantom e conecta. Não são
  // duas carteiras — é a mesma, agora também no Phantom. Filtrar só por
  // walletClientType não basta: tem que comparar ENDEREÇO, senão a UI lista a
  // carteira do fã como "externa vinculada" a si mesma (E16). É também por isso
  // que a identidade é o DID, nunca a carteira.
  const externas = solanas.filter(
    (w) => w.walletClientType !== 'privy' && w.address !== embedded?.address,
  );
  const tambemNoPhantom =
    !!embedded &&
    solanas.some((w) => w.walletClientType !== 'privy' && w.address === embedded.address);

  return { embedded, externas, tambemNoPhantom };
}

/**
 * Nome/e-mail servem somente para o fã reconhecer a própria conta no perfil.
 * O apelido público continua sendo escolhido no onboarding (E12), e o DID
 * continua sendo a única identidade da aplicação.
 */
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

  // Watchdog: com origem não liberada, appId errado ou rede fora, o
  // PrivyProvider fica em branco e calado PARA SEMPRE (E7). Sem isto ninguém
  // descobre — descobre o jurado, na frente do vídeo.
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

  /**
   * O provider é registrado UMA vez e lê o estado por ref. Parece rebuscado e não é.
   *
   * Registrar dentro de um efeito que depende de `authenticated` abre uma janela
   * de um ciclo: o React roda efeitos de BAIXO PRA CIMA, então a tela (filha)
   * dispara o fetch antes de esta ilha (mãe) registrar o provider novo — e o que
   * está registrado ainda é o closure velho, que capturou `authenticated: false`
   * e devolve null. O Bearer não vai, o servidor recusa com 401, e o fã LOGADO lê
   * "sem sessão verificada". Só o segundo fetch acertava.
   *
   * Com deps `[]` o provider nunca fica obsoleto: a identidade é estável e os
   * valores saem das refs, sempre frescos. É a mesma família do E7/E14 — a Privy
   * não erra alto, ela erra fora de hora.
   */
  const authRef = useRef(authenticated);
  authRef.current = authenticated;
  const getTokenRef = useRef(getAccessToken);
  getTokenRef.current = getAccessToken;

  const tokenProvider = useCallback(async () => {
    if (!authRef.current) return null;
    return getTokenRef.current();
  }, []);

  // O cliente REST assina toda requisição com este Bearer. O servidor resolve o
  // usuário pelo DID verificado — body.userId NUNCA (CONTEXT.md §4).
  useEffect(() => {
    setAuthTokenProvider(tokenProvider);
  }, [tokenProvider]);

  const doExport = useCallback(async () => {
    if (!embedded) return;
    // A chave é remontada fora do nosso alcance: nem o Palpitei nem a Privy veem
    // a chave inteira. A promise resolve quando o fã FECHA o modal — mas se o
    // modal não abrir, ela nunca settla e o botão morre em "Abrindo…" para
    // sempre. try/finally não salva; só a corrida com timeout salva (E14).
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
      // `stuck` só vale enquanto a Privy NÃO subiu. O timer é de mão única
      // (setStuck(true) e nunca false), então numa conexão lenta a ilha ficava
      // pronta em 9s, o login funcionava — e o alerta vermelho continuava na
      // tela para sempre, empurrando o fã para o demo sem motivo. Pior: como o
      // login (page.tsx) renderiza `stuck ? loginStuck : erro`, a trava também
      // mascarava todo erro real dali em diante. Se ficou pronta, não travou.
      stuck: stuck && !ready,
      enabled: true,
      tambemNoPhantom,
      wallets: [
        ...(embedded ? [{ address: embedded.address, source: 'privy_embedded' as const }] : []),
        ...externas.map((w) => ({ address: w.address, source: 'external' as const })),
      ],
      getAccessToken: tokenProvider,
      // Opção A (padrão): Google/e-mail → carteira Solana embutida provisionada
      // automaticamente. É o critério nº 1 da trilha: sem seed phrase, sem instalar nada.
      loginWithGoogle: async () => {
        login({ loginMethods: ['google', 'email'] });
      },
      // Opção B: abre o modal já na lista de carteiras — extensão no desktop,
      // deeplink/QR no mobile. Quem faz o trabalho sujo são os connectors de Solana.
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
  // Sem appId a ilha inteira sai do caminho — o modo demo continua entrando, que
  // é justamente o ponto dele (o jurado testa sem carteira e sem custo, §5.1).
  if (!APP_ID) {
    return <PrivyContext.Provider value={desligada}>{children}</PrivyContext.Provider>;
  }

  // No browser, `http://localhost` é uma exceção e conta como contexto seguro.
  // `http://<ip-da-lan>` não conta. A Privy rejeita embedded wallet fora de
  // contexto seguro porque depende de WebCrypto; sem este guard, abrir pelo
  // celular via IP derruba a página inteira antes de mostrar qualquer UI.
  const canUseEmbeddedWallet = typeof window === 'undefined' || window.isSecureContext;

  return (
    <PrivyProvider
      appId={APP_ID}
      config={{
        // Apple fora de propósito: é porta de mão única — a credencial padrão da
        // Privy NÃO migra, e trocar depois exige app nova + migrar todo mundo
        // (E8). O Google já prova o fluxo: a carteira embutida não depende de
        // qual OAuth trouxe o fã.
        loginMethods: ['google', 'email', 'wallet'],
        appearance: {
          theme: 'dark',
          accentColor: '#C8F13F', // --lime
          walletChainType: 'solana-only',
          // Phantom primeiro reduz ambiguidade no celular: no Safari/Chrome
          // mobile, a Privy cai no conector/deeplink disponível para essa
          // carteira; no desktop ainda aparecem extensões Solana detectadas.
          walletList: ['phantom', 'solflare', 'backpack', 'detected_solana_wallets'],
        },
        // O default da Privy é 'off' → o login social FUNCIONA e o fã entra SEM
        // carteira Solana: o requisito "sign up through Solana" cai calado (E2).
        //
        // 'users-without-wallets' (e NÃO 'all-users') é o que desenha as duas
        // opções sem sobreposição: quem entra por Google não tem carteira →
        // ganha a embutida (Opção A); quem entra com a Phantom já tem a dele →
        // NÃO ganha embutida, e a dele é a identidade (Opção B, autocustódia).
        // Com 'all-users' o fã da Opção B ganhava uma embutida que não pediu (E11).
        //
        // Na divergência entre isto e o painel, VALE ISTO.
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
