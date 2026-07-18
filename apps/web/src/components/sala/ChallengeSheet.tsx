'use client';


import type { ChallengeText } from '@/lib/i18n';
import type { ChallengeSpec } from '@/lib/mock';
import { useI18n } from '@/lib/i18n';
import { fw } from '@/lib/tokens';
import { Star } from '@/components/Icons';

interface Props {
  spec: ChallengeSpec;
  text: ChallengeText;
  secs: number;
  duration: number;
  onAnswer: (optId: string) => void;
}

export function ChallengeSheet({ spec, text, secs, duration, onAnswer }: Props) {
  const { t } = useI18n();

  const timerPct = Math.max(0, Math.round((secs / duration) * 100));
  // This is presentational only; the server enforces the actual deadline.
  const timerColor = secs <= 4 ? 'var(--red)' : 'var(--lime)';

  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 20 }}>
      <div
        style={{
          height: 72,
          marginBottom: -1,
          pointerEvents: 'none',
          background: 'linear-gradient(180deg, transparent, var(--bg-app))',
        }}
      />
      <div
        style={{
          maxHeight: 520,
          overflowY: 'auto',
          background: 'var(--surface-1)',
          borderTop: '1.5px solid var(--lime-line)',
          borderRadius: 'var(--r-4xl) var(--r-4xl) 0 0',
          padding: '12px 20px 24px',
          boxShadow: 'var(--shadow-toast)',
          animation: 'sheetUp .38s cubic-bezier(.2,.85,.25,1) both',
        }}
      >
        <div
          style={{
            width: 40,
            height: 5,
            borderRadius: 'var(--r-pill)',
            background: 'var(--border-2)',
            margin: '0 auto 14px',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: fw.black, fontSize: 10, letterSpacing: 1, color: 'var(--lime)' }}>
            {t.challengeLive} · {text.type}
          </span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 11,
              fontWeight: fw.black,
              color: 'var(--gold)',
            }}
          >
            <Star size={12} />
            {t.worth} {spec.xp} XP
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 12 }}>
          <div
            style={{
              flex: 1,
              height: 7,
              borderRadius: 'var(--r-pill)',
              background: 'var(--surface-sunken)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                borderRadius: 'var(--r-pill)',
                background: timerColor,
                width: `${timerPct}%`,
                transition: 'width 1s linear',
              }}
            />
          </div>
          <span
            style={{
              fontSize: 13,
              fontWeight: fw.black,
              color: timerColor,
              minWidth: 30,
              textAlign: 'right',
            }}
          >
            {secs}s
          </span>
        </div>

        <div
          style={{
            fontWeight: fw.black,
            fontStyle: 'italic',
            fontSize: 21,
            lineHeight: 1.2,
            letterSpacing: -0.3,
            marginTop: 14,
            textWrap: 'pretty',
          }}
        >
          {text.prompt}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
          {spec.optIds.map((id) => {
            const pct = spec.pct[id];
            const label = text.opts[id];
            return (
              <button
                key={id}
                onClick={() => onAnswer(id)}
                style={{
                  all: 'unset',
                  boxSizing: 'border-box',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '15px 16px',
                  minHeight: 'var(--tap-min)',
                  borderRadius: 'var(--r-xl)',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border-2)',
                  color: 'var(--text-hi)',
                  fontWeight: fw.bold,
                  fontSize: 15,
                  transition: 'background .15s, border-color .15s, transform .1s',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{label ?? id}</span>
                {/* A missing probability is not 0%; omit it rather than fabricating a value. */}
                {pct !== undefined && pct !== null && (
                  <span style={{ fontSize: 12.5, fontWeight: fw.heavy, color: 'var(--text-muted)' }}>
                    {pct}%
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div
          style={{
            textAlign: 'center',
            fontSize: 11.5,
            fontWeight: fw.medium,
            color: 'var(--text-muted)',
            marginTop: 14,
            textWrap: 'pretty',
          }}
        >
          {t.fairNote}
        </div>
      </div>
    </div>
  );
}
