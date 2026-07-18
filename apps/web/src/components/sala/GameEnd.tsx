'use client';


import { useI18n, fill } from '@/lib/i18n';
import { fw } from '@/lib/tokens';
import { Button, ProgressBar } from '@/components/ds';
import { Screen } from '@/components/Shell';
import { FlagArgentina, FlagCaboVerde } from '@/components/Flag';
import { levelProgress } from '@/lib/session';

interface Props {
  scoreA: number;
  scoreB: number;
  salaXp: number;
  correctCount: number;
  total: number;
  level: number;
  xp: number;
  onShare: () => void;
  onHome: () => void;
}

const CONFETTI = [
  { left: '22%', top: '20%', w: 9, h: 14, bg: 'var(--lime)', rot: 24, dur: '1.6s', delay: '.1s' },
  { left: '74%', top: '24%', w: 8, h: 13, bg: 'var(--gold)', rot: -18, dur: '1.9s', delay: '.3s' },
  { left: '60%', top: '44%', w: 9, h: 14, bg: 'var(--lime)', rot: 40, dur: '2.1s', delay: '.2s' },
  { left: '16%', top: '52%', w: 8, h: 12, bg: 'var(--orange)', rot: -30, dur: '1.7s', delay: '.5s' },
  { left: '38%', top: '58%', w: 8, h: 13, bg: 'var(--blue)', rot: 14, dur: '2s', delay: '.4s' },
];

export function GameEnd({ scoreA, scoreB, salaXp, correctCount, total, level, xp, onShare, onHome }: Props) {
  const { t, fmt } = useI18n();
  const { pct, toNext } = levelProgress(xp);

  return (
    <Screen style={{ display: 'flex', flexDirection: 'column', padding: '20px 22px 26px', position: 'relative' }}>
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        {CONFETTI.map((c, i) => (
          <span
            key={i}
            style={{
              position: 'absolute',
              left: c.left,
              top: c.top,
              width: c.w,
              height: c.h,
              background: c.bg,
              borderRadius: 2,
              transform: `rotate(${c.rot}deg)`,
              animation: `fadeUp ${c.dur} ease-in-out ${c.delay} infinite alternate`,
            }}
          />
        ))}
      </div>

      <div style={{ textAlign: 'center', position: 'relative', animation: 'fadeUp .5s ease both' }}>
        <div style={{ fontSize: 11, fontWeight: fw.black, letterSpacing: 1.2, color: 'var(--text-muted)' }}>
          {t.stageRound32}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 6 }}>
          <Streamer a="var(--lime)" b="var(--gold)" rotA={-18} rotB={20} />
          <span style={{ fontWeight: fw.black, fontSize: 38, fontStyle: 'italic', letterSpacing: -1.5, lineHeight: 1 }}>
            {t.fimTitle}
          </span>
          <Streamer a="var(--orange)" b="var(--lime)" rotA={18} rotB={-20} />
        </div>
      </div>

      <div
        style={{
          position: 'relative',
          marginTop: 22,
          background: 'var(--surface-1)',
          border: '1px solid var(--border-2)',
          borderRadius: 'var(--r-3xl)',
          padding: '20px 18px',
          animation: 'popIn .5s cubic-bezier(.2,.9,.3,1.2) both',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: 88 }}>
            <FlagArgentina width={42} height={28} />
            <span style={{ fontWeight: fw.heavy, fontSize: 13, textAlign: 'center' }}>{t.tArgentina}</span>
          </div>
          <span style={{ fontWeight: fw.black, fontSize: 38, fontStyle: 'italic', letterSpacing: -2, lineHeight: 1 }}>
            {scoreA} – {scoreB}
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: 88 }}>
            <FlagCaboVerde width={42} height={28} />
            <span style={{ fontWeight: fw.heavy, fontSize: 13, textAlign: 'center' }}>{t.tCaboVerde}</span>
          </div>
        </div>
        <div
          style={{
            textAlign: 'center',
            fontSize: 11.5,
            fontWeight: fw.medium,
            color: 'var(--text-muted)',
            marginTop: 14,
            borderTop: '1px solid var(--border-1)',
            paddingTop: 12,
          }}
        >
          {t.fimScorers}
        </div>
      </div>

      <div style={{ position: 'relative', display: 'flex', gap: 10, marginTop: 12 }}>
        <StatBox value={`+${fmt(salaXp)}`} label={t.fimXpLabel} accent="var(--lime)" highlight />
        <StatBox value={`${correctCount}/${total}`} label={t.fimPicksLabel} />
        <StatBox value={t.friendPos} label={t.fimFriendsLabel} />
      </div>

      <div style={{ position: 'relative', marginTop: 16 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 11,
            fontWeight: fw.heavy,
            color: 'var(--text-muted)',
            marginBottom: 8,
          }}
        >
          <span>
            {t.levelWord} {level}
          </span>
          <span>
            {t.levelWord} {level + 1}
          </span>
        </div>
        <ProgressBar value={pct} />
        <div style={{ textAlign: 'center', fontSize: 12, fontWeight: fw.bold, color: 'var(--text-2)', marginTop: 8 }}>
          {fill(t.toNextLevel, { xp: fmt(toNext) })}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 20 }} />
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 }}>
        <Button size="lg" full onClick={onShare}>
          {t.fimShare}
        </Button>
        <Button variant="ghost" full onClick={onHome}>
          {t.backHome}
        </Button>
      </div>
    </Screen>
  );
}

function StatBox({
  value,
  label,
  accent,
  highlight = false,
}: {
  value: string;
  label: string;
  accent?: string;
  highlight?: boolean;
}) {
  return (
    <div
      style={{
        flex: 1,
        background: 'var(--surface-1)',
        border: `1px solid ${highlight ? 'var(--lime-line)' : 'var(--border-1)'}`,
        borderRadius: 'var(--r-2xl)',
        padding: '15px 8px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontWeight: fw.black, fontStyle: 'italic', fontSize: 22, color: accent ?? 'var(--text-hi)' }}>
        {value}
      </div>
      <div style={{ fontSize: 10, fontWeight: fw.heavy, letterSpacing: 0.5, color: 'var(--text-muted)', marginTop: 3 }}>
        {label}
      </div>
    </div>
  );
}

function Streamer({ a, b, rotA, rotB }: { a: string; b: string; rotA: number; rotB: number }) {
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 3 }} aria-hidden="true">
      <span style={{ width: 10, height: 5, background: a, borderRadius: 2, transform: `rotate(${rotA}deg)` }} />
      <span style={{ width: 8, height: 5, background: b, borderRadius: 2, transform: `rotate(${rotB}deg)` }} />
    </span>
  );
}
