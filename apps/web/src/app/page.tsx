'use client';

/**
 * LOGIN — Google/Privy · carteira · DEMO.
 *
 * O botão DEMO não é enfeite: a regra §5.1 do hackathon exige que o jurado teste
 * SEM CARTEIRA e SEM CUSTO. Ele entra na hora, numa conta de teste
 * (walletSource: 'simulated'), sem passar pela Privy. É o caminho mais testado
 * da casa — por isso é ele que ganha o anel de glow, e não o Google.
 *
 * Google e carteira levam ao onboarding (conta nova): quem escolhe o apelido é o
 * fã. Derivar do e-mail vaza o endereço no ranking (E12).
 */

import { useRouter } from 'next/navigation';
import { Screen } from '@/components/Shell';
import { Logo, Wordmark } from '@/components/Brand';
import { Ball, GoogleMark, PrivyMark, SolanaMark, PlayCircle } from '@/components/Icons';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { usePrivyAuth } from '@/components/privy/PrivyIsland';
import { fw } from '@/lib/tokens';
import { consumePendingReturnTo, returnToFromSearch, setPendingReturnTo } from '@/lib/return-to';

const EASE = 'cubic-bezier(.2,.7,.3,1)';

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  const { session, hydrated, enterDemo, startOnboarding, enterExisting } = useSession();
  const privy = usePrivyAuth();
  const [erro, setErro] = useState<string | null>(null);
  // Um POST /api/login em voo por vez: o efeito re-dispara a cada dep, e dois
  // find-or-create simultâneos do mesmo DID são a corrida que o banco resolve
  // mas o roteamento não (duas navegações brigando).
  const entrando = useRef(false);
  // Muda a cada clique num botão de login — é o que permite TENTAR DE NOVO
  // depois de um /api/login que falhou (as outras deps não mudam nesse caso).
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    const destination = returnToFromSearch(window.location.search);
    if (destination) setPendingReturnTo(destination);
  }, []);

  const onDemo = () => {
    // O demo não pode carregar um convite real pendente para um login futuro.
    consumePendingReturnTo();
    enterDemo();
    router.push('/home');
  };

  // A Privy autentica no modal dela e volta para cá; é este efeito que reage.
  // Não dá para encadear no clique: o login resolve antes do estado assentar, e
  // no reload a sessão revive sozinha sem passar por clique nenhum.
  useEffect(() => {
    // `hydrated` primeiro: antes do sessionStorage ser lido, `session` é null e
    // TODA sessão parece conta nova. Sem esta linha, recarregar '/' autenticado
    // zerava a sessão gravada antes mesmo de alguém tocar em nada.
    if (!hydrated) return;
    if (!privy.authenticated || !privy.did) return;

    // Quem JÁ tem sessão real não recomeça o cadastro: sem apelido = ainda no
    // meio (o passo 1 é quem grava); com apelido, está dentro — vai pra casa.
    if (session && session.authMethod !== 'demo') {
      router.replace(session.nickname.trim() ? consumePendingReturnTo() : '/onboarding');
      return;
    }

    // Sem sessão local (aba nova, outro aparelho) — ou só a do DEMO, que não
    // pertence a DID nenhum e cede a um login real. Quem sabe se a conta é nova
    // é o SERVIDOR: o find-or-create por DID do POST /api/login. A versão
    // anterior decidia aqui na tela ("sem sessão = conta nova") e o retorno de
    // um fã cadastrado virava onboarding de novo — com o UNIQUE do banco
    // recusando o próprio apelido dele (409) no passo 1.
    if (entrando.current) return;
    entrando.current = true;
    const method = privy.wallets[0]?.source === 'external' ? 'wallet' : 'google';
    void (async () => {
      try {
        const { api } = await import('@/lib/api');
        const { user } = await api.login();
        if (user.nickname) {
          // Conta VELHA: a sessão nasce do que o banco sabe (apelido, XP,
          // nível, time) e o fã volta direto para casa.
          enterExisting(method, user);
          router.replace(consumePendingReturnTo());
        } else {
          // Sem apelido no banco = conta nova (ou cadastro interrompido):
          // termina o onboarding. replace, e não push: depois de entrar, o
          // login não fica no histórico — com push, o Voltar caía em '/', o
          // efeito disparava de novo e cada tentativa zerava o cadastro.
          startOnboarding(method);
          router.replace('/onboarding');
        }
      } catch {
        // Servidor fora: erro na tela, e NUNCA "conta nova" por cima de uma
        // possivelmente existente — mock com cara de real é a regra 4. O fã
        // tenta de novo pelo botão (que bumpa `tentativa`).
        entrando.current = false;
        setErro(t.loginFailed);
      }
    })();
  }, [
    hydrated,
    session,
    privy.authenticated,
    privy.did,
    privy.wallets,
    startOnboarding,
    enterExisting,
    router,
    tentativa,
    t.loginFailed,
  ]);

  const onSocial = async (method: 'google' | 'wallet') => {
    setErro(null);
    try {
      await (method === 'google' ? privy.loginWithGoogle() : privy.loginWithWallet());
      // Já autenticado de uma tentativa anterior? O estado da Privy não muda e
      // o efeito não re-dispara sozinho — o bump garante a nova ida ao servidor.
      setTentativa((n) => n + 1);
    } catch (e) {
      // A Privy falha calada quase sempre; quando ela fala, a gente mostra.
      setErro(e instanceof Error ? e.message : 'não deu para entrar agora');
    }
  };

  return (
    <Screen style={{ display: 'flex', flexDirection: 'column', padding: '0 26px 30px' }}>
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          textAlign: 'center',
        }}
      >
        <div style={{ animation: `fadeUp .6s ${EASE} both` }}>
          <Logo size={80} glow />
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 9,
            justifyContent: 'center',
            marginTop: 24,
            animation: `fadeUp .6s ${EASE} .08s both`,
          }}
        >
          <Wordmark size={34} />
          <span
            style={{
              fontSize: 10,
              fontWeight: fw.heavy,
              letterSpacing: 1.2,
              color: 'var(--on-lime)',
              background: 'var(--lime)',
              padding: '3px 7px',
              borderRadius: 'var(--r-sm)',
              position: 'relative',
              top: -3,
            }}
          >
            BETA
          </span>
        </div>

        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            marginTop: 14,
            padding: '6px 12px',
            border: '1px solid var(--lime-line)',
            borderRadius: 'var(--r-pill)',
            animation: `fadeUp .6s ${EASE} .14s both`,
          }}
        >
          <Ball />
          <span style={{ fontSize: 12, fontWeight: fw.heavy, letterSpacing: 0.6, color: 'var(--lime)' }}>
            {t.worldcup}
          </span>
        </div>

        <p
          style={{
            margin: '22px auto 0',
            maxWidth: 255,
            fontSize: 15,
            lineHeight: 'var(--leading-body)',
            fontWeight: fw.medium,
            color: 'var(--text-2)',
            animation: `fadeUp .6s ${EASE} .2s both`,
          }}
        >
          {t.tagline}
        </p>
      </div>

      <div
        style={{
          flex: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          animation: `fadeUp .6s ${EASE} .28s both`,
        }}
      >
        <button
          onClick={() => onSocial('google')}
          style={{
            all: 'unset',
            cursor: 'pointer',
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            height: 56,
            borderRadius: 'var(--r-xl)',
            background: 'var(--text-hi)',
            color: 'var(--on-lime)',
            fontFamily: 'var(--font-sans)',
            fontSize: 15.5,
            fontWeight: fw.bold,
          }}
        >
          <GoogleMark />
          <span>{t.google}</span>
          <span style={{ width: 1, height: 20, background: 'color-mix(in srgb, var(--on-lime) 16%, transparent)' }} />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <PrivyMark />
            <span style={{ fontWeight: fw.heavy, letterSpacing: -0.2 }}>Privy</span>
          </span>
        </button>

        <button
          onClick={() => onSocial('wallet')}
          style={{
            all: 'unset',
            cursor: 'pointer',
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            height: 56,
            borderRadius: 'var(--r-xl)',
            background: 'var(--surface-1)',
            border: '1px solid var(--border-2)',
            color: 'var(--text-hi)',
            fontFamily: 'var(--font-sans)',
            fontSize: 16,
            fontWeight: fw.bold,
          }}
        >
          <SolanaMark />
          <span>{t.wallet}</span>
        </button>

        {/* O caminho do jurado. `glow` é o keyframe do ds — o anel do CTA real. */}
        <button
          onClick={onDemo}
          style={{
            all: 'unset',
            cursor: 'pointer',
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 11,
            height: 56,
            borderRadius: 'var(--r-xl)',
            background: 'var(--lime-a06)',
            border: '1.5px solid var(--lime-a30)',
            color: 'var(--lime)',
            fontFamily: 'var(--font-sans)',
            fontSize: 16,
            fontWeight: fw.heavy,
            animation: 'glow 2.6s ease-in-out infinite',
          }}
        >
          <PlayCircle />
          <span>{t.demo}</span>
        </button>

        {/* A Privy falha calada quase sempre (E7/E9). Quando ela fala, o fã vê —
            um estado de erro que ninguém renderiza é a mesma falha silenciosa
            que este projeto existe para evitar. */}
        {(erro || privy.stuck) && (
          <p
            role="alert"
            style={{
              margin: '4px auto 0',
              maxWidth: 300,
              textAlign: 'center',
              fontSize: 12,
              lineHeight: 'var(--leading-body)',
              fontWeight: fw.bold,
              color: 'var(--red)',
            }}
          >
            {privy.stuck ? t.loginStuck : erro}
          </p>
        )}

        <p
          style={{
            margin: '10px auto 0',
            maxWidth: 300,
            textAlign: 'center',
            fontSize: 12,
            lineHeight: 'var(--leading-body)',
            fontWeight: fw.medium,
            color: 'var(--text-muted)',
          }}
        >
          {t.demoNote}
        </p>
      </div>
    </Screen>
  );
}
