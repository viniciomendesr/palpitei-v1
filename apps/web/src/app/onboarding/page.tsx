'use client';


import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ds';
import { Screen } from '@/components/Shell';
import { Logo } from '@/components/Brand';
import { ChevronLeft, Check } from '@/components/Icons';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { fw } from '@/lib/tokens';
import { useRequireSession } from '@/lib/guard';
import { NicknameInput, MAX_NICK, isNicknameValid } from '@/components/NicknameInput';
import { consumePendingReturnTo } from '@/lib/return-to';

const EASE = 'cubic-bezier(.2,.7,.3,1)';

export default function OnboardingPage() {
  const router = useRouter();
  const { t } = useI18n();
  const { session, update, logout } = useSession();
  const ready = useRequireSession();

  const [step, setStep] = useState(0);
  const [nameDraft, setNameDraft] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erroNome, setErroNome] = useState<string | null>(null);

  if (!ready || !session) return null;

  const draft = nameDraft.trim();
  const nameInvalid = !isNicknameValid(nameDraft);

  const next = async () => {
    if (step === 1) {
      if (nameInvalid || salvando) return;
      setSalvando(true);
      setErroNome(null);
      const { api, ApiError } = await import('@/lib/api');
      try {
        await api.setHandle(draft);
      } catch (e) {
        setErroNome(e instanceof ApiError ? e.message : t.nameSaveFailed);
        return;
      } finally {
        setSalvando(false);
      }
      update({ nickname: draft });
    }
    setStep((s) => s + 1);
  };

  const back = async () => {
    if (step === 0) {
      await logout();
      router.replace('/');
      return;
    }
    setStep((s) => Math.max(0, s - 1));
  };

  const finish = () => router.replace(consumePendingReturnTo());

  const pct = Math.round(Math.min(step, 2) / 2 * 100);
  const stepLabel = `${t.obStep} ${Math.min(step + 1, 2)} ${t.obOf} 2`;
  const isWallet = session.authMethod === 'wallet';

  return (
    <Screen style={{ display: 'flex', flexDirection: 'column', padding: '8px 26px 30px' }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0 18px' }}>
        <button
          onClick={back}
          aria-label={t.cancel}
          style={{
            all: 'unset',
            cursor: 'pointer',
            width: 34,
            height: 34,
            borderRadius: 'var(--r-md)',
            background: 'var(--surface-1)',
            border: '1px solid var(--border-1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ChevronLeft />
        </button>
        <div
          style={{
            flex: 1,
            height: 6,
            borderRadius: 'var(--r-pill)',
            background: 'var(--surface-sunken)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              borderRadius: 'var(--r-pill)',
              background: 'var(--lime)',
              width: `${pct}%`,
              transition: 'width .35s cubic-bezier(.2,.8,.3,1)',
            }}
          />
        </div>
        <span
          style={{
            fontSize: 10,
            fontWeight: fw.black,
            letterSpacing: 0.6,
            color: 'var(--text-muted)',
            minWidth: 64,
            textAlign: 'right',
          }}
        >
          {stepLabel}
        </span>
      </div>

      {step === 0 && (
        <>
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              animation: `fadeUp .5s ${EASE} both`,
            }}
          >
            <div
              style={{
                display: 'inline-flex',
                alignSelf: 'flex-start',
                alignItems: 'center',
                gap: 8,
                padding: '7px 13px',
                borderRadius: 'var(--r-pill)',
                background: 'var(--lime-a10)',
                border: '1px solid var(--lime-line)',
              }}
            >
              <Check size={15} width={2.4} />
              <span style={{ fontSize: 12, fontWeight: fw.heavy, color: 'var(--lime)' }}>
                {isWallet ? t.obWelcomeHdrWallet : t.obWelcomeHdrGoogle} ·{' '}
                {isWallet ? t.obWelcomeViaWallet : t.obWelcomeViaGoogle}
              </span>
            </div>

            <div style={{ margin: '26px 0 0' }}>
              <Logo size={72} glow />
            </div>

            <div
              style={{
                fontWeight: fw.black,
                fontStyle: 'italic',
                fontSize: 30,
                letterSpacing: -1,
                marginTop: 22,
                lineHeight: 1.05,
                textWrap: 'pretty',
              }}
            >
              {t.obWelcomeTitle}
            </div>
            <p
              style={{
                fontSize: 15,
                lineHeight: 'var(--leading-body)',
                fontWeight: fw.medium,
                color: 'var(--text-2)',
                marginTop: 12,
                maxWidth: 290,
                textWrap: 'pretty',
              }}
            >
              {t.obWelcomeBody}
            </p>
          </div>
          <div style={{ flex: 'none' }}>
            <Button size="lg" full onClick={next}>
              {t.obStart}
            </Button>
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', animation: `fadeUp .45s ${EASE} both` }}>
            <div
              style={{
                fontWeight: fw.black,
                fontStyle: 'italic',
                fontSize: 26,
                letterSpacing: -0.6,
                marginTop: 8,
                textWrap: 'pretty',
              }}
            >
              {t.obNameTitle}
            </div>
            <p
              style={{
                fontSize: 14,
                lineHeight: 'var(--leading-body)',
                fontWeight: fw.medium,
                color: 'var(--text-2)',
                marginTop: 10,
                textWrap: 'pretty',
              }}
            >
              {t.obNameBody}
            </p>
            <NicknameInput
              value={nameDraft}
              onChange={(v) => {
                setNameDraft(v);
                setErroNome(null);
              }}
              invalid={nameInvalid}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: fw.heavy,
                  color: nameInvalid ? 'var(--text-muted)' : 'var(--lime)',
                }}
              >
                {nameInvalid ? t.nameHintShort : t.nameHintOk}
              </span>
              <span style={{ fontSize: 11, fontWeight: fw.bold, color: 'var(--text-muted)' }}>
                {draft.length}/{MAX_NICK}
              </span>
            </div>
            {erroNome && (
              <p
                role="alert"
                style={{
                  marginTop: 12,
                  fontSize: 12.5,
                  fontWeight: fw.bold,
                  lineHeight: 'var(--leading-body)',
                  color: 'var(--red)',
                  textWrap: 'pretty',
                }}
              >
                {erroNome}
              </p>
            )}
          </div>
          <div style={{ flex: 'none' }}>
            <Button size="lg" full disabled={nameInvalid || salvando} onClick={next}>
              {t.obContinue}
            </Button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              textAlign: 'center',
              animation: 'popIn .5s cubic-bezier(.2,.9,.3,1.2) both',
            }}
          >
            <div
              style={{
                width: 88,
                height: 88,
                borderRadius: '50%',
                background: 'var(--lime-a14)',
                border: '1.5px solid var(--lime-line)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Check size={42} width={2.6} />
            </div>
            <div
              style={{
                fontWeight: fw.black,
                fontStyle: 'italic',
                fontSize: 28,
                letterSpacing: -0.8,
                marginTop: 22,
                textWrap: 'pretty',
              }}
            >
              {t.obReadyTitle} {session.nickname.trim() || t.readyNameFallback}!
            </div>
            <p
              style={{
                fontSize: 15,
                lineHeight: 'var(--leading-body)',
                fontWeight: fw.medium,
                color: 'var(--text-2)',
                marginTop: 12,
                maxWidth: 280,
                textWrap: 'pretty',
              }}
            >
              {t.obReadyBody}
            </p>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                marginTop: 18,
                padding: '8px 14px',
                borderRadius: 'var(--r-pill)',
                background: 'var(--surface-1)',
                border: '1px solid var(--border-2)',
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: 'var(--gold)',
                  boxShadow: '0 0 8px var(--gold)',
                }}
              />
              <span style={{ fontSize: 12, fontWeight: fw.heavy, color: 'var(--text-1)' }}>
                {t.newUserBadge} · 0 XP
              </span>
            </div>
          </div>
          <div style={{ flex: 'none' }}>
            <Button size="lg" full onClick={finish}>
              {t.obFinish}
            </Button>
          </div>
        </>
      )}
    </Screen>
  );
}
