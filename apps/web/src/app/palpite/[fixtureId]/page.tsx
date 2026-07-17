'use client';

/**
 * PALPITE PRÉ-JOGO — o fã crava até quatro palpites antes do apito, valendo XP.
 *
 * Estrutura do mockup: cabeçalho FIXO (times + horário), corpo que ROLA (os
 * quatro mercados) e rodapé FIXO (progresso + confirmar) — como a sala. O cérebro
 * (demo × logado, estado, trava, liquidação) vive em usePalpitePreJogo.
 */

import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ds';
import { Screen } from '@/components/Shell';
import { ChevronLeft, Star, Triangle, Lock } from '@/components/Icons';
import { useI18n } from '@/lib/i18n';
import { fw } from '@/lib/tokens';
import { useRequireSession } from '@/lib/guard';
import { usePalpitePreJogo } from '@/lib/usePalpitePreJogo';
import type { PregameMarket } from '@/lib/api';
import {
  AvataresEmpilhados,
  ClockIcon,
  MercadoCard,
  Segmentado,
  Stepper,
  ToastBanner,
} from '@/components/palpite/PreJogoUI';

/** Os três amigos do demo — as mesmas iniciais/cores do mockup. */
const AMIGOS_DEMO = [
  { label: 'DD', color: 'var(--gold)', ink: 'var(--bg-app)' },
  { label: 'MG', color: 'var(--blue)', ink: 'var(--bg-app)' },
  { label: 'BZ', color: 'var(--orange)', ink: 'var(--bg-app)' },
];

export default function PalpitePreJogoPage() {
  const params = useParams<{ fixtureId: string }>();
  const fixtureId = params.fixtureId;
  const router = useRouter();
  const { t, fmt } = useI18n();
  const pronto = useRequireSession();

  const jogo = usePalpitePreJogo(fixtureId);
  const { vm, m, filled, xpInPlay, availableMarkets, saving, toast } = jogo;

  const voltar = () => router.push('/home');

  if (!pronto) return null;

  if (jogo.loading) {
    return (
      <Screen style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <span style={{ fontSize: 13, fontWeight: fw.medium, color: 'var(--text-muted)' }}>{t.pmLoading}</span>
      </Screen>
    );
  }

  if (jogo.error || !vm) {
    return (
      <Screen style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }}>
        <span role="alert" style={{ fontSize: 13, fontWeight: fw.medium, color: 'var(--red)', textAlign: 'center', lineHeight: 'var(--leading-body)' }}>
          {t.pmError} {jogo.error ?? ''}
        </span>
        <Button variant="ghost" onClick={voltar}>
          {t.backHome}
        </Button>
      </Screen>
    );
  }

  const locked = vm.locked;
  const worth = (xp: number) => `${t.worth} ${xp} XP`;
  const confirmLabel = vm.submitted ? t.pmSave : t.pmConfirm;

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {/* ---------- cabeçalho fixo ---------- */}
      <div
        style={{
          flex: 'none',
          padding: '12px 18px 14px',
          background: 'linear-gradient(180deg, var(--surface-header), var(--bg-app))',
          borderBottom: '1px solid var(--border-1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            aria-label={t.backHome}
            onClick={voltar}
            style={{
              all: 'unset',
              cursor: 'pointer',
              width: 34,
              height: 34,
              borderRadius: 10,
              background: 'var(--surface-1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ChevronLeft size={18} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: fw.black, fontStyle: 'italic', fontSize: 18, letterSpacing: -0.4 }}>{t.pmTitle}</div>
            {vm.group && (
              <div style={{ fontSize: 11, fontWeight: fw.heavy, letterSpacing: 0.4, color: 'var(--text-muted)' }}>{vm.group}</div>
            )}
          </div>
          {vm.submitted && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '5px 10px',
                borderRadius: 'var(--r-pill)',
                background: 'var(--lime-a14)',
                border: '1px solid var(--lime-line)',
                fontSize: 9.5,
                fontWeight: fw.black,
                letterSpacing: 0.5,
                color: 'var(--lime)',
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--lime)' }} />
              {t.pmSubmitted}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginTop: 16, padding: '0 4px' }}>
          <TimeBadge code={vm.codeA} color={vm.colA} name={vm.teamA} />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, paddingTop: 8 }}>
            <span style={{ fontWeight: fw.black, fontStyle: 'italic', fontSize: 16, color: 'var(--text-faint)', letterSpacing: 0.5 }}>VS</span>
            <span style={{ fontSize: 11, fontWeight: fw.heavy, letterSpacing: 0.3, color: 'var(--text-1)' }}>{vm.kickoffText}</span>
          </div>
          <TimeBadge code={vm.codeB} color={vm.colB} name={vm.teamB} />
        </div>

        {/* pill: fecha em … / travado */}
        {locked ? (
          <div style={pillStyle}>
            <Lock size={12} color="var(--text-muted)" />
            <span style={{ fontSize: 11.5, fontWeight: fw.heavy, color: 'var(--text-muted)' }}>{t.pmLockedTitle}</span>
          </div>
        ) : (
          <div style={pillStyle}>
            <ClockIcon size={13} color="var(--lime)" />
            <span style={{ fontSize: 11.5, fontWeight: fw.heavy, color: 'var(--lime)' }}>
              {t.pmClosesIn} {vm.closesText} · {t.pmKickWord}
            </span>
          </div>
        )}
      </div>

      {/* ---------- corpo rolável ---------- */}
      <Screen padding="14px 18px 20px">
        {/* social — só no demo (o logado não inventa "amigos já palpitaram") */}
        {vm.friends != null && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 11,
              padding: '12px 14px',
              borderRadius: 'var(--r-2xl)',
              background: 'var(--surface-1)',
              border: '1px solid var(--border-1)',
            }}
          >
            <AvataresEmpilhados items={AMIGOS_DEMO} />
            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: fw.bold, color: 'var(--text-2)', lineHeight: 1.35 }}>
              <span style={{ color: 'var(--text-hi)', fontWeight: fw.black }}>{vm.friends}</span> {t.pmSocial}
            </span>
            <button
              type="button"
              onClick={jogo.desafiarLiga}
              style={{
                all: 'unset',
                cursor: 'pointer',
                flex: 'none',
                fontSize: 11.5,
                fontWeight: fw.black,
                color: 'var(--lime)',
                padding: '7px 12px',
                borderRadius: 'var(--r-pill)',
                border: '1px solid var(--lime-line)',
                background: 'var(--lime-a06)',
              }}
            >
              {t.pmChallenge}
            </button>
          </div>
        )}

        {vm.txlineOddsAvailable && vm.markets.length > 0 ? (
          <div style={{ margin: '3px 2px 1px', fontSize: 9.5, fontWeight: fw.black, letterSpacing: 0.8, color: 'var(--text-faint)' }}>
            {t.pmTxlineChances}
          </div>
        ) : (
          <MercadoIndisponivel text={vm.friends != null ? t.pmDemoOddsUnavailable : t.pmMarketUnavailable} />
        )}

        {/* A lista da TxLINE, não quatro cards previamente desenhados. */}
        {vm.markets.map((market) => (
          <MercadoTxline
            key={market.id}
            market={market}
            teamA={vm.teamA}
            teamB={vm.teamB}
            result={m.result}
            goals={m.goals}
            corners={m.corners}
            locked={locked}
            t={t}
            fmt={fmt}
            worth={worth}
            selectedText={t.pmSelected}
            onResult={jogo.setResult}
            onGoals={jogo.setGoals}
            onCorners={jogo.setCorners}
          />
        ))}

        {/* 2. PLACAR EXATO */}
        <MercadoCard label={t.pmScoreHdr} sub={t.pmScoreSub} worthText={worth(60)} selectedText={t.pmSelected} selected={m.scoreTouched}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 18, marginTop: 16 }}>
            <Stepper code={vm.codeA} color={vm.colA} value={m.scoreA} onDec={() => jogo.step('a', -1)} onInc={() => jogo.step('a', 1)} disabled={locked} />
            <span style={{ fontWeight: fw.black, fontStyle: 'italic', fontSize: 24, color: 'var(--text-faint)', marginTop: 28 }}>×</span>
            <Stepper code={vm.codeB} color={vm.colB} value={m.scoreB} onDec={() => jogo.step('b', -1)} onInc={() => jogo.step('b', 1)} disabled={locked} />
          </div>
        </MercadoCard>

        {/* nota de justiça */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 11,
            marginTop: 14,
            padding: '13px 15px',
            borderRadius: 'var(--r-2xl)',
            background: 'var(--lime-a06)',
            border: '1px solid var(--lime-line)',
          }}
        >
          <span style={{ flex: 'none', marginTop: 1 }}>
            <Triangle size={16} color="var(--lime)" />
          </span>
          <span style={{ fontSize: 12.5, fontWeight: fw.bold, color: 'var(--text-1)', lineHeight: 1.4 }}>
            {locked ? t.pmLockedNote : t.pmFairNote}
          </span>
        </div>
      </Screen>

      {/* ---------- rodapé fixo ---------- */}
      {!locked && (
        <div
          style={{
            flex: 'none',
            padding: '12px 18px 22px',
            borderTop: '1px solid var(--border-1)',
            background: 'var(--surface-header)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11 }}>
            <span style={{ fontSize: 12, fontWeight: fw.heavy, color: 'var(--text-2)' }}>
              {filled} {t.pmPicksOf} {availableMarkets} {t.pmPicksWord}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: fw.black, color: 'var(--gold)' }}>
              <Star size={14} />+{fmt(xpInPlay)} {t.pmXpInPlay}
            </span>
          </div>
          <Button size="lg" full disabled={filled < 1 || saving} onClick={jogo.confirmar}>
            {confirmLabel}
          </Button>
        </div>
      )}

      {toast && <ToastBanner title={toast.title} sub={toast.sub} />}
    </div>
  );
}

const pillStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 7,
  marginTop: 14,
  padding: '7px 12px',
  borderRadius: 'var(--r-pill)',
  background: 'var(--lime-a06)',
  border: '1px solid var(--lime-line)',
} as const;

function TimeBadge({ code, color, name }: { code: string; color: string; name: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: 104 }}>
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: 15,
          background: 'var(--surface-2)',
          border: '1px solid var(--border-2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: fw.black,
          fontStyle: 'italic',
          fontSize: 16,
          letterSpacing: -0.5,
          color,
        }}
      >
        {code}
      </div>
      <span style={{ fontWeight: fw.heavy, fontSize: 13.5, textAlign: 'center' }}>{name}</span>
    </div>
  );
}

/** Um card por item recebido na lista TxLINE; nenhuma categoria é reservada na UI. */
function MercadoTxline({
  market,
  teamA,
  teamB,
  result,
  goals,
  corners,
  locked,
  t,
  fmt,
  worth,
  selectedText,
  onResult,
  onGoals,
  onCorners,
}: {
  market: PregameMarket;
  teamA: string;
  teamB: string;
  result: 'home' | 'draw' | 'away' | null;
  goals: 'over' | 'under' | null;
  corners: 'over' | 'under' | null;
  locked: boolean;
  t: ReturnType<typeof useI18n>['t'];
  fmt: (n: number) => string;
  worth: (xp: number) => string;
  selectedText: string;
  onResult: (id: 'home' | 'draw' | 'away') => void;
  onGoals: (id: 'over' | 'under') => void;
  onCorners: (id: 'over' | 'under') => void;
}) {
  if (market.kind === 'result') {
    const labels = { home: teamA, draw: t.pmDraw, away: teamB } as const;
    const options = market.options.map((option) => ({
      id: option.id,
      label: labels[option.id],
      detail: chance(option.pct, fmt),
    }));
    return (
      <MercadoCard label={t.pmResultHdr} sub={t.pmResultSub} worthText={worth(30)} selectedText={selectedText} selected={!!result}>
        <Segmentado options={options} value={result} onSelect={onResult} disabled={locked} />
      </MercadoCard>
    );
  }

  const isGoals = market.id === 'goals';
  const options = market.options.map((option) => ({
    id: option.id,
    label: `${option.id === 'over' ? t.pmOver : t.pmUnder} ${fmt(market.line)}`,
    detail: chance(option.pct, fmt),
  }));
  const value = isGoals ? goals : corners;
  return (
    <MercadoCard
      label={isGoals ? t.pmGolsHdr : t.pmCornersHdr}
      sub={isGoals ? t.pmGolsSub : t.pmCornersSub}
      worthText={worth(25)}
      selectedText={selectedText}
      selected={!!value}
    >
      <Segmentado options={options} value={value} onSelect={isGoals ? onGoals : onCorners} disabled={locked} />
    </MercadoCard>
  );
}

function chance(pct: number, fmt: (n: number) => string): string {
  return `${fmt(pct)}%`;
}

function MercadoIndisponivel({ text }: { text: string }) {
  return (
    <div
      style={{
        marginTop: 12,
        padding: '12px 15px',
        borderRadius: 'var(--r-2xl)',
        background: 'var(--surface-sunken)',
        border: '1px solid var(--border-1)',
        fontSize: 12,
        fontWeight: fw.medium,
        color: 'var(--text-muted)',
        lineHeight: 1.4,
      }}
    >
      {text}
    </div>
  );
}
