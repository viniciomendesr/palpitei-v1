'use client';

/**
 * Pre-login tour: three scenes explaining the game before the fan authenticates.
 *
 * The scenes are drawn, never screenshots, and every scoreline in them is a public
 * FIFA fact (CONTEXT §13) rather than an illustrative mock — Argentina 1–1 Cape Verde
 * at 64' and the England 1–2 Argentina semifinal. XP, trophy and level figures are the
 * demo-only mechanics §13 allows to be plausible estimates.
 */

import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { Logo } from '@/components/Brand';
import { ArrowRight, Broadcast, Replay, Trophy, Bolt } from '@/components/Icons';
import { fw } from '@/lib/tokens';
import { MATCH_START } from '@/lib/mock';

const EASE = 'cubic-bezier(.2,.7,.3,1)';
const STEPS = 3;

// The design system ships --gold but no translucent gold; derive the tints from the
// token instead of hardcoding an rgba that would drift if --gold ever changes.
const GOLD_LINE = 'color-mix(in srgb, var(--gold) 28%, transparent)';
const GOLD_TINT = 'color-mix(in srgb, var(--gold) 14%, transparent)';

const card: React.CSSProperties = {
  background: 'var(--surface-1)',
  border: '1px solid var(--border-1)',
  borderRadius: 18,
  padding: '15px 16px',
  boxShadow: 'var(--shadow-toast)',
};

const tagStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: fw.heavy,
  letterSpacing: '.6px',
};

const stageStyle: React.CSSProperties = {
  fontSize: 9.5,
  fontWeight: fw.heavy,
  letterSpacing: '.6px',
  color: 'var(--text-fainter)',
};

const teamStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: fw.heavy,
  color: 'var(--text-hi)',
};

const scoreStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: fw.black,
  fontStyle: 'italic',
  letterSpacing: -1,
};

function SceneLive() {
  const { t } = useI18n();
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span
            style={{
              ...tagStyle,
              color: 'var(--red)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: 'var(--red)',
                animation: 'pulse 1.6s ease-in-out infinite',
              }}
            />
            {t.liveShort} · {MATCH_START.minute}’
          </span>
          <span style={stageStyle}>{t.tourLiveStage}</span>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            marginTop: 14,
          }}
        >
          <span style={teamStyle}>{t.tArgentina}</span>
          <span style={{ ...scoreStyle, color: 'var(--text-hi)' }}>
            {MATCH_START.scoreA}–{MATCH_START.scoreB}
          </span>
          <span style={{ ...teamStyle, textAlign: 'right' }}>{t.tCaboVerde}</span>
        </div>

        <div
          style={{
            marginTop: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 7,
            height: 38,
            borderRadius: 12,
            background: 'var(--lime)',
            color: 'var(--on-lime)',
            fontSize: 13,
            fontWeight: fw.heavy,
          }}
        >
          {t.tourLiveCta}
          <ArrowRight size={15} />
        </div>
      </div>

      <div
        style={{
          alignSelf: 'flex-end',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderRadius: 12,
          background: 'var(--surface-2)',
          border: '1px solid var(--lime-line)',
          boxShadow: 'var(--shadow-toast)',
        }}
      >
        <span style={{ fontSize: 11, fontWeight: fw.bold, color: 'var(--text-2)' }}>
          {t.tourNextGoal}
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: fw.heavy,
            color: 'var(--on-lime)',
            background: 'var(--lime)',
            padding: '3px 8px',
            borderRadius: 8,
          }}
        >
          {t.tArgentina}
        </span>
        <span style={{ fontSize: 11, fontWeight: fw.heavy, color: 'var(--lime)' }}>+30 XP</span>
      </div>
    </div>
  );
}

function SceneReplay() {
  const { t } = useI18n();
  const speeds = ['1×', '2×', '4×', '8×'];
  return (
    <div style={{ ...card, width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ ...tagStyle, color: 'var(--text-muted)' }}>{t.tourReplayTag}</span>
        <span style={stageStyle}>{t.tourReplayStage}</span>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginTop: 13,
        }}
      >
        <span style={teamStyle}>{t.tInglaterra}</span>
        <span style={{ ...scoreStyle, color: 'var(--text-2)' }}>1–2</span>
        <span style={{ ...teamStyle, textAlign: 'right' }}>{t.tArgentina}</span>
      </div>

      <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            flex: 'none',
            width: 34,
            height: 34,
            borderRadius: '50%',
            background: 'var(--lime)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 6v12l9-6-9-6z" fill="var(--on-lime)" />
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              position: 'relative',
              height: 5,
              borderRadius: 99,
              background: 'var(--surface-disabled)',
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: '0 auto 0 0',
                width: '42%',
                borderRadius: 99,
                background: 'var(--lime)',
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: '42%',
                top: '50%',
                width: 11,
                height: 11,
                borderRadius: '50%',
                background: 'var(--lime)',
                transform: 'translate(-50%,-50%)',
                boxShadow: '0 0 0 3px var(--lime-a30)',
              }}
            />
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: 6,
              fontSize: 9.5,
              fontWeight: fw.bold,
              color: 'var(--text-muted)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <span>38’</span>
            <span>90’</span>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14, display: 'flex', gap: 6 }}>
        {speeds.map((s) => {
          const on = s === '2×';
          return (
            <span
              key={s}
              style={{
                flex: 1,
                textAlign: 'center',
                padding: '6px 0',
                borderRadius: 9,
                fontSize: 11,
                fontWeight: fw.heavy,
                color: on ? 'var(--on-lime)' : 'var(--text-muted)',
                background: on ? 'var(--lime)' : 'var(--surface-2)',
                border: on ? '1px solid transparent' : '1px solid var(--border-1)',
              }}
            >
              {s}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function SceneRewards() {
  const { t, fmt } = useI18n();
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 11 }}>
      <div style={{ display: 'flex', gap: 11 }}>
        <div
          style={{
            flex: 1,
            background: 'var(--surface-1)',
            border: '1px solid var(--lime-line)',
            borderRadius: 16,
            padding: '14px 13px',
          }}
        >
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 9,
              background: 'var(--lime-a14)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Bolt size={16} color="var(--lime)" />
          </div>
          <div
            style={{
              marginTop: 11,
              fontSize: 21,
              fontWeight: fw.black,
              fontStyle: 'italic',
              letterSpacing: -0.6,
              color: 'var(--text-hi)',
            }}
          >
            {fmt(1240)}
          </div>
          <div
            style={{ marginTop: 2, fontSize: 10.5, fontWeight: fw.bold, color: 'var(--text-muted)' }}
          >
            {t.tourXpCaption}
          </div>
        </div>

        <div
          style={{
            flex: 1,
            background: 'var(--surface-1)',
            border: `1px solid ${GOLD_LINE}`,
            borderRadius: 16,
            padding: '14px 13px',
          }}
        >
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 9,
              background: GOLD_TINT,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Trophy size={16} />
          </div>
          <div
            style={{
              marginTop: 11,
              fontSize: 21,
              fontWeight: fw.black,
              fontStyle: 'italic',
              letterSpacing: -0.6,
              color: 'var(--gold)',
            }}
          >
            3
          </div>
          <div
            style={{ marginTop: 2, fontSize: 10.5, fontWeight: fw.bold, color: 'var(--text-muted)' }}
          >
            {t.tourTrophyCaption}
          </div>
        </div>
      </div>

      <div
        style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--border-1)',
          borderRadius: 16,
          padding: '13px 15px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 11,
            fontWeight: fw.heavy,
          }}
        >
          <span style={{ color: 'var(--text-hi)' }}>{t.tourLevelLabel}</span>
          <span style={{ color: 'var(--text-muted)' }}>{t.tourLevelNext}</span>
        </div>
        <div
          style={{
            marginTop: 9,
            position: 'relative',
            height: 6,
            borderRadius: 99,
            background: 'var(--surface-disabled)',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: '0 auto 0 0',
              width: '64%',
              borderRadius: 99,
              background: 'var(--lime)',
            }}
          />
        </div>
      </div>
    </div>
  );
}

const SCENES = [SceneLive, SceneReplay, SceneRewards];
const ICONS = [Broadcast, Replay, Trophy];

export function Tour({ onDone }: { onDone: () => void }) {
  const { t, lang, setLang } = useI18n();
  const [step, setStep] = useState(0);

  const Scene = SCENES[step]!;
  const Icon = ICONS[step]!;
  const last = step === STEPS - 1;
  const copy = t.tour[step] ?? t.tour[0]!;

  const advance = () => (last ? onDone() : setStep((s) => s + 1));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.tourBadge}
      style={{
        flex: 1,
        minHeight: 0,
        background:
          'radial-gradient(125% 80% at 50% -8%, var(--surface-1) 0%, var(--bg-app) 52%, var(--bg-page) 100%)',
        display: 'flex',
        flexDirection: 'column',
        padding: '52px 24px 26px',
        animation: `fadeUp .45s ${EASE} both`,
      }}
    >
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
          <Logo size={30} glow />
          <span
            style={{
              fontSize: 11,
              fontWeight: fw.heavy,
              letterSpacing: '1.4px',
              color: 'var(--text-muted)',
            }}
          >
            {t.tourBadge}
          </span>
        </div>

        <div
          role="group"
          aria-label={t.tourLangLabel}
          style={{
            display: 'flex',
            gap: 4,
            background: 'var(--surface-sunken)',
            border: '1px solid var(--border-1)',
            borderRadius: 'var(--r-pill)',
            padding: 3,
          }}
        >
          {(['pt', 'en'] as const).map((l) => {
            const on = lang === l;
            return (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                aria-pressed={on}
                style={{
                  all: 'unset',
                  cursor: 'pointer',
                  padding: '7px 14px',
                  borderRadius: 'var(--r-pill)',
                  fontSize: 12,
                  fontWeight: fw.heavy,
                  letterSpacing: '.5px',
                  background: on ? 'var(--lime)' : 'transparent',
                  color: on ? 'var(--on-lime)' : 'var(--text-muted)',
                }}
              >
                {l.toUpperCase()}
              </button>
            );
          })}
        </div>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          marginTop: 20,
          borderRadius: 24,
          overflow: 'hidden',
          border: '1px solid var(--border-1)',
          background:
            'radial-gradient(125% 100% at 50% -5%, var(--surface-1) 0%, var(--bg-app) 60%, var(--bg-page) 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '22px 20px',
        }}
      >
        <div key={step} style={{ width: '100%', animation: `fadeUp .4s ease both` }}>
          <Scene />
        </div>
      </div>

      <div
        style={{ flex: 'none', marginTop: 22, display: 'flex', alignItems: 'center', gap: 14 }}
      >
        <div style={{ flex: 1, display: 'flex', gap: 7 }} aria-hidden="true">
          {Array.from({ length: STEPS }, (_, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: 4,
                borderRadius: 99,
                transition: 'background .3s',
                background: i <= step ? 'var(--lime)' : 'var(--surface-2)',
              }}
            />
          ))}
        </div>
        <span
          style={{
            fontSize: 12,
            fontWeight: fw.heavy,
            letterSpacing: '1px',
            color: 'var(--text-muted)',
            fontVariantNumeric: 'tabular-nums',
          }}
          aria-label={`${t.tourStepLabel} ${step + 1}/${STEPS}`}
        >
          {String(step + 1).padStart(2, '0')} / {String(STEPS).padStart(2, '0')}
        </span>
      </div>

      <div
        style={{ flex: 'none', marginTop: 20, display: 'flex', alignItems: 'center', gap: 14 }}
      >
        <div
          style={{
            flex: 'none',
            width: 52,
            height: 52,
            borderRadius: 16,
            background: 'var(--lime-a14)',
            border: '1px solid var(--lime-line)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon size={26} color="var(--lime)" />
        </div>
        <h1
          style={{
            margin: 0,
            fontSize: 24,
            fontWeight: fw.black,
            fontStyle: 'italic',
            letterSpacing: -0.6,
            lineHeight: 1.08,
            textWrap: 'balance',
          }}
        >
          {copy.title}
        </h1>
      </div>

      <p
        style={{
          margin: '15px 0 0',
          fontSize: 14.5,
          lineHeight: 1.55,
          fontWeight: fw.medium,
          color: 'var(--text-2)',
          textWrap: 'pretty',
        }}
      >
        {copy.body}
      </p>

      <div
        style={{
          flex: 'none',
          marginTop: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <button
          type="button"
          onClick={onDone}
          style={{
            all: 'unset',
            cursor: 'pointer',
            padding: '10px 4px',
            minHeight: 'var(--tap-min)',
            display: 'inline-flex',
            alignItems: 'center',
            fontSize: 14,
            fontWeight: fw.bold,
            color: 'var(--text-muted)',
          }}
        >
          {t.tourSkip}
        </button>
        <button
          type="button"
          onClick={advance}
          style={{
            all: 'unset',
            cursor: 'pointer',
            boxSizing: 'border-box',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 9,
            height: 52,
            padding: '0 26px',
            borderRadius: 'var(--r-xl)',
            background: 'var(--lime)',
            color: 'var(--on-lime)',
            fontFamily: 'var(--font-sans)',
            fontSize: 15.5,
            fontWeight: fw.heavy,
            boxShadow: 'var(--shadow-btn)',
          }}
        >
          <span>{last ? t.tourStart : t.tourNext}</span>
          <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}
