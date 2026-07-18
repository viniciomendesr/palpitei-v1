'use client';


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
  const { session, hydrated, enterDemo, startOnboarding, enterExisting, adocaoFalhou, retentarAdocao } =
    useSession();
  const privy = usePrivyAuth();
  const [erro, setErro] = useState<string | null>(null);
  const entrando = useRef(false);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    const destination = returnToFromSearch(window.location.search);
    if (destination) setPendingReturnTo(destination);
  }, []);

  const onDemo = () => {
    consumePendingReturnTo();
    enterDemo();
    router.push('/home');
  };

  useEffect(() => {
    if (!hydrated) return;
    if (!privy.authenticated || !privy.did) return;

    if (session && session.authMethod !== 'demo') {
      router.replace(session.nickname.trim() ? consumePendingReturnTo() : '/onboarding');
      return;
    }

    // A missing session is adopted by SessionProvider (which serves every route, not
    // just this one); waiting for it avoids two concurrent `api.login()` for one DID.
    // The effect re-runs once the session lands, and only then picks a destination.
    if (!session) return;

    // What remains is the fan on demo in this tab who already has a real Privy account:
    // the provider never overwrites an existing session, so promotion stays this screen's job.
    if (entrando.current) return;
    entrando.current = true;
    const method = privy.wallets[0]?.source === 'external' ? 'wallet' : 'google';
    void (async () => {
      try {
        const { api } = await import('@/lib/api');
        const { user } = await api.login();
        if (user.nickname) {
          enterExisting(method, user);
          router.replace(consumePendingReturnTo());
        } else {
          startOnboarding(method);
          router.replace('/onboarding');
        }
      } catch {
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
    // Someone already authenticated in Privy neither needs nor can log in again: what
    // failed was /api/login. The tap becomes the retry button for session adoption.
    if (privy.authenticated) {
      retentarAdocao();
      return;
    }
    try {
      await (method === 'google' ? privy.loginWithGoogle() : privy.loginWithWallet());
      setTentativa((n) => n + 1);
    } catch (e) {
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

        {(erro || adocaoFalhou || privy.stuck) && (
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
            {privy.stuck ? t.loginStuck : (erro ?? t.loginFailed)}
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
