'use client';

/**
 * Post-match summary.
 *
 * Extracted from `SalaReal` so the "Meus palpites" screen can be the SAME screen
 * rather than a second one that drifts from it. Two callers, two data sources:
 * the room feeds it from live state, `/meus-palpites/[fixtureId]` feeds it from
 * persisted rows.
 *
 * `chancesCount` is nullable on purpose. Chance readings are only kept for a
 * running room, so persisted history genuinely does not have them, and printing
 * a zero would read as "no chance moved in this match" — a number that lies.
 * Absent means the card is not shown at all.
 */

import { Badge, Button } from '@/components/ds';
import { Screen } from '@/components/Shell';
import { ChevronLeft } from '@/components/Icons';
import { useI18n } from '@/lib/i18n';
import { fw } from '@/lib/tokens';
import { calcularResumoDaSala } from '@/lib/resumo';
import type { SalaResultado } from '@/lib/useSala';

export type LinhaDeStat = {
  chave: string;
  label: string;
  /** Rendered as-is. Feed totals are numbers; the demo also carries '59%'. */
  a: string | number;
  b: string | number;
  aFlex: number;
  bFlex: number;
};

/** Builds the stat rows from feed totals, ordered by the localized label set. */
export function linhasDeStats(
  totals: { p1: Record<string, number>; p2: Record<string, number> },
  rotulos: Record<string, string>,
): LinhaDeStat[] {
  const ordem = Object.keys(rotulos);
  const posicao = (k: string) => {
    const i = ordem.indexOf(k);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };

  return [...new Set([...Object.keys(totals.p1), ...Object.keys(totals.p2)])]
    .sort((a, b) => posicao(a) - posicao(b) || a.localeCompare(b))
    .map((chave) => {
      const a = totals.p1[chave] ?? 0;
      const b = totals.p2[chave] ?? 0;
      return {
        chave,
        label: rotulos[chave] ?? chave,
        a,
        b,
        aFlex: Math.max(a, 0.4),
        bFlex: Math.max(b, 0.4),
      };
    });
}

export function ResumoDaPartida({
  teamA,
  teamB,
  score,
  resultados,
  rankingCount,
  chancesCount,
  stats,
  title,
  onBack,
  onHome,
  backLabel,
  homeLabel,
}: {
  teamA: string;
  teamB: string;
  score: { p1: number; p2: number };
  resultados: SalaResultado[];
  rankingCount: number;
  /** `null` when chance readings were not kept for this run. */
  chancesCount: number | null;
  stats: LinhaDeStat[];
  /** Overrides the section label; the room keeps its own wording. */
  title?: string;
  onBack: () => void;
  onHome: () => void;
  backLabel?: string;
  homeLabel?: string;
}) {
  const { t } = useI18n();
  const summary = calcularResumoDaSala(resultados, rankingCount, chancesCount ?? 0);
  const cards = [
    { value: String(summary.picks), label: t.summaryPicks },
    { value: String(summary.hits), label: t.summaryHits },
    { value: String(summary.players), label: t.summaryPlayers },
    ...(chancesCount === null
      ? []
      : [{ value: String(summary.movements), label: t.summaryMovements }]),
  ];
  const voltar = backLabel ?? t.summaryBack;

  return (
    <Screen padding="18px 20px 24px" style={{ display: 'flex', flexDirection: 'column' }}>
      <button
        onClick={onBack}
        aria-label={voltar}
        style={{ all: 'unset', cursor: 'pointer', width: 38, height: 38, display: 'grid', placeItems: 'center', borderRadius: 'var(--r-lg)', background: 'var(--surface-1)' }}
      >
        <ChevronLeft />
      </button>
      <div style={{ textAlign: 'center', marginTop: 12 }}>
        <Badge tone="neutral">{t.lanceEnd}</Badge>
        <div style={{ marginTop: 15, fontSize: 11, fontWeight: fw.black, letterSpacing: 1.2, color: 'var(--text-muted)' }}>
          {title ?? t.summaryTitle}
        </div>
        <div style={{ marginTop: 8, fontSize: 19, fontWeight: fw.heavy }}>{teamA} × {teamB}</div>
        <div style={{ marginTop: 4, fontSize: 48, fontWeight: fw.black, fontStyle: 'italic', letterSpacing: -2 }}>
          {score.p1} – {score.p2}
        </div>
        <div style={{ color: 'var(--lime)', fontWeight: fw.black, fontSize: 14 }}>+{summary.xp} XP</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9, marginTop: 22 }}>
        {cards.map((card) => (
          <div key={card.label} style={{ padding: '14px 12px', borderRadius: 'var(--r-xl)', background: 'var(--surface-1)', border: '1px solid var(--border-1)' }}>
            <div style={{ fontSize: 22, fontWeight: fw.black, color: 'var(--lime)' }}>{card.value}</div>
            <div style={{ marginTop: 3, fontSize: 10.5, fontWeight: fw.heavy, color: 'var(--text-muted)' }}>{card.label}</div>
          </div>
        ))}
      </div>

      {stats.length > 0 && (
        <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 11 }}>
          {stats.map((stat) => (
            <div key={stat.chave} style={{ display: 'grid', gridTemplateColumns: '36px 1fr 36px', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: fw.black, color: 'var(--lime)' }}>{stat.a}</span>
              <span style={{ textAlign: 'center', fontSize: 11, fontWeight: fw.heavy, color: 'var(--text-muted)' }}>{stat.label}</span>
              <span style={{ textAlign: 'right', fontWeight: fw.black }}>{stat.b}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 24 }} />
      <Button full size="lg" onClick={onBack}>{voltar}</Button>
      <Button full variant="ghost" onClick={onHome}>{homeLabel ?? t.backHome}</Button>
    </Screen>
  );
}
