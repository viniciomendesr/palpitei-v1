'use client';


import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SegTabs, Badge, Button } from '@/components/ds';
import { Screen } from '@/components/Shell';
import { ChevronLeft, ChevronRight, Star } from '@/components/Icons';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { fw } from '@/lib/tokens';
import {
  useSala,
  type SalaChance,
  type SalaDesafio,
  type SalaLance,
  type SalaResultado,
  type SalaTotais,
} from '@/lib/useSala';
import { redigeChance } from '@/lib/chances';
import { formataRelogio } from '@/lib/relogio';
import { calcularResumoDaSala } from '@/lib/resumo';
import { usePrivyAuth } from '@/components/privy/PrivyIsland';
import { localizeTeamName } from '@/lib/team-names';
import type { LobbyState } from '@/lib/api';

type SalaTab = 'desafios' | 'lances' | 'stats' | 'chances' | 'ranking';

// This screen renders server-authoritative state; it never settles predictions or XP.

function textoDoLance(
  l: SalaLance,
  t: ReturnType<typeof useI18n>['t'],
  teamA: string,
  teamB: string,
): string {
  if (l.goals) return `${t.lanceGoal}: ${teamA} ${l.goals.p1} × ${l.goals.p2} ${teamB}`;
  const nomes: Record<string, string> = {
    kickoff: t.lanceKickoff,
    corner: t.lanceCorner,
    shot: t.lanceShot,
    yellow_card: t.lanceYellow,
    red_card: t.lanceRed,
    substitution: t.lanceSub,
    injury: t.lanceInjury,
    additional_time: t.lanceExtra,
    halftime_finalised: t.lanceHalftime,
    game_finalised: t.lanceEnd,
  };
  return nomes[l.action] ?? l.action;
}

type Dicionario = ReturnType<typeof useI18n>['t'];

function textoDaPergunta(
  type: string,
  promptDoServidor: string,
  t: Dicionario,
  teamA: string,
  teamB: string,
): string {
  switch (type) {
    case 'final_result':
      return t.qPromptFinal.replace('{a}', teamA).replace('{b}', teamB);
    case 'next_goal':
      return t.qPromptNextGoal;
    case 'hilo_corners':
      return t.qPromptHilo;
    default:
      return promptDoServidor;
  }
}

function rotuloDaOpcao(
  id: string,
  t: Dicionario,
  teamA: string,
  teamB: string,
  fallback?: { id: string; label: string }[],
): string {
  switch (id) {
    case 'p1':
      return teamA;
    case 'p2':
      return teamB;
    case 'draw':
      return t.optDraw;
    case 'none':
      return t.optNone;
    case 'yes':
      return t.optYes;
    case 'no':
      return t.optNo;
    default:
      return fallback?.find((o) => o.id === id)?.label ?? id;
  }
}

function explicacaoDoResultado(
  r: SalaResultado,
  t: Dicionario,
  teamA: string,
  teamB: string,
): string | null {
  const f = r.facts;
  if (!f) return null;
  const minuto = f.minute !== null ? String(f.minute) : '–';
  switch (r.qtype) {
    case 'final_result':
      return t.explFinal.replace('{a}', String(f.score.p1)).replace('{b}', String(f.score.p2));
    case 'next_goal': {
      if (r.correctOptionId === 'none') return t.explNextGoalNone;
      if (r.correctOptionId !== 'p1' && r.correctOptionId !== 'p2') return null;
      return t.explNextGoalTeam
        .replace('{team}', r.correctOptionId === 'p1' ? teamA : teamB)
        .replace('{m}', minuto)
        .replace('{a}', String(f.score.p1))
        .replace('{b}', String(f.score.p2));
    }
    case 'hilo_corners': {
      if (!f.corners) return null;
      const base = r.correctOptionId === 'yes' ? t.explHiloYes : t.explHiloNo;
      return base
        .replace('{ca}', String(f.corners.p1))
        .replace('{cb}', String(f.corners.p2))
        .replace('{m}', minuto);
    }
    default:
      return null;
  }
}

function BarraDupla({ label, a, b }: { label: string; a: number; b: number }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontWeight: fw.black, fontSize: 14, color: 'var(--lime)' }}>{a}</span>
        <span style={{ fontSize: 11, fontWeight: fw.heavy, letterSpacing: 0.5, color: 'var(--text-muted)' }}>{label}</span>
        <span style={{ fontWeight: fw.black, fontSize: 14, color: 'var(--text-1)' }}>{b}</span>
      </div>
      <div style={{ display: 'flex', gap: 6, height: 8 }}>
        {/* Keep zero-valued stats visible without changing the displayed value. */}
        <div style={{ flex: Math.max(a, 0.4), background: 'var(--lime)', borderRadius: '99px 4px 4px 99px' }} />
        <div style={{ flex: Math.max(b, 0.4), background: 'var(--surface-2)', borderRadius: '4px 99px 99px 4px' }} />
      </div>
    </div>
  );
}

function DetalheDoResultado({
  r,
  teamA,
  teamB,
  onVoltar,
}: {
  r: SalaResultado;
  teamA: string;
  teamB: string;
  onVoltar: () => void;
}) {
  const { t } = useI18n();
  const acertou =
    !r.voidReason && r.correctOptionId !== undefined && r.minhaEscolha === r.correctOptionId;
  const minha =
    r.minhaEscolha !== null ? rotuloDaOpcao(r.minhaEscolha, t, teamA, teamB, r.options) : null;
  const certa =
    r.correctOptionId !== undefined
      ? rotuloDaOpcao(r.correctOptionId, t, teamA, teamB, r.options)
      : null;
  const leitura = explicacaoDoResultado(r, t, teamA, teamB);
  const titulo = r.voidReason ? t.salaVoid : acertou ? t.salaHit : t.salaMiss;
  const corTitulo = r.voidReason ? 'var(--text-muted)' : acertou ? 'var(--lime)' : 'var(--text-hi)';

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'var(--bg-app)',
        display: 'flex',
        flexDirection: 'column',
        animation: 'fadeUp .25s cubic-bezier(.2,.7,.3,1) both',
      }}
    >
      <div style={{ flex: 'none', padding: '12px 18px 0' }}>
        <button
          onClick={onVoltar}
          aria-label={t.voltarAoJogo}
          style={{
            all: 'unset',
            cursor: 'pointer',
            width: 34,
            height: 34,
            borderRadius: 'var(--r-md)',
            background: 'var(--surface-1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ChevronLeft size={18} />
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 22px 24px' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: fw.black, fontStyle: 'italic', fontSize: 30, letterSpacing: -1, color: corTitulo, textWrap: 'pretty' }}>
            {titulo}
          </div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 12,
              padding: '6px 14px',
              borderRadius: 'var(--r-pill)',
              border: `1px solid ${r.gained > 0 ? 'var(--lime-line)' : 'var(--border-2)'}`,
              fontSize: 12.5,
              fontWeight: fw.black,
              color: r.gained > 0 ? 'var(--gold)' : acertou ? 'var(--orange)' : 'var(--text-muted)',
            }}
          >
            {r.gained > 0 ? (
              <>
                <Star />
                {`+${r.gained} XP`}
              </>
            ) : acertou ? (
              t.treinoSelo
            ) : (
              t.resSemXp
            )}
          </div>
        </div>

        <div
          style={{
            marginTop: 20,
            padding: '14px 16px',
            borderRadius: 'var(--r-xl)',
            background: 'var(--surface-1)',
            border: `1px solid ${acertou ? 'var(--lime-line)' : 'var(--border-1)'}`,
          }}
        >
          <p style={{ fontSize: 15.5, fontWeight: fw.heavy, textWrap: 'pretty' }}>
            {r.qtype ? textoDaPergunta(r.qtype, r.prompt, t, teamA, teamB) : r.prompt}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
            {minha && (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontSize: 11, fontWeight: fw.black, letterSpacing: 0.8, color: 'var(--text-muted)' }}>
                  {t.youPick}
                </span>
                <span style={{ fontSize: 13.5, fontWeight: fw.heavy }}>{minha}</span>
              </div>
            )}
            {certa && !r.voidReason && (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontSize: 11, fontWeight: fw.black, letterSpacing: 0.8, color: 'var(--text-muted)' }}>
                  {t.rightPick}
                </span>
                <span style={{ fontSize: 13.5, fontWeight: fw.heavy, color: 'var(--lime)' }}>{certa}</span>
              </div>
            )}
          </div>
        </div>

        {(leitura || r.voidReason || r.facts) && (
          <div
            style={{
              marginTop: 12,
              padding: '14px 16px',
              borderRadius: 'var(--r-xl)',
              background: 'var(--surface-1)',
              border: '1px solid var(--border-1)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 10.5, fontWeight: fw.black, letterSpacing: 1, color: 'var(--lime)' }}>
                {t.resReadingHdr}
              </span>
              {r.facts?.minute !== null && r.facts?.minute !== undefined && (
                <span style={{ fontSize: 11, fontWeight: fw.black, color: 'var(--text-muted)' }}>
                  {r.facts.minute}’
                </span>
              )}
            </div>
            <p style={{ fontSize: 13.5, fontWeight: fw.medium, lineHeight: 'var(--leading-body)', color: 'var(--text-1)', marginTop: 8, textWrap: 'pretty' }}>
              {r.voidReason ? t.salaVoidBody : leitura}
            </p>

            {r.facts && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: fw.heavy, fontSize: 12, color: 'var(--text-1)' }}>{teamA}</span>
                  <span style={{ fontSize: 9.5, fontWeight: fw.black, letterSpacing: 1, color: 'var(--text-faint)' }}>
                    {t.resMomento}
                  </span>
                  <span style={{ fontWeight: fw.heavy, fontSize: 12, color: 'var(--text-1)' }}>{teamB}</span>
                </div>
                <BarraDupla
                  label={t.statKeys['Goals'] ?? 'Goals'}
                  a={r.facts.score.p1}
                  b={r.facts.score.p2}
                />
                {r.facts.corners && (
                  <BarraDupla
                    label={t.statKeys['Corners'] ?? 'Corners'}
                    a={r.facts.corners.p1}
                    b={r.facts.corners.p2}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ flex: 'none', padding: '0 18px 18px' }}>
        <Button size="lg" full onClick={onVoltar}>
          {t.voltarAoJogo}
        </Button>
      </div>
    </div>
  );
}

function BarraDeChance({
  label,
  pct,
  tone,
  valueColor,
}: {
  label: string;
  pct: number;
  tone: string;
  valueColor: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ fontSize: 11.5, fontWeight: fw.bold, color: 'var(--text-muted)', minWidth: 44 }}>{label}</span>
      <div
        style={{
          flex: 1,
          height: 9,
          borderRadius: 'var(--r-pill)',
          background: 'var(--surface-sunken)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            borderRadius: 'var(--r-pill)',
            background: tone,
            width: `${Math.min(Math.max(pct, 0), 100)}%`,
          }}
        />
      </div>
      <span style={{ fontSize: 12.5, fontWeight: fw.black, color: valueColor, minWidth: 46, textAlign: 'right' }}>
        {pct.toFixed(1)}%
      </span>
    </div>
  );
}

function LinhaDeChance({ c, teamA, teamB }: { c: SalaChance; teamA: string; teamB: string }) {
  const { t } = useI18n();
  return (
    <div
      style={{
        padding: '12px 14px 14px',
        borderRadius: 'var(--r-xl)',
        background: 'var(--surface-1)',
        border: '1px solid var(--border-1)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{ fontSize: 11, fontWeight: fw.black, color: 'var(--lime)', minWidth: 30 }}>
          {c.minute !== null ? `${c.minute}’` : '–'}
        </span>
        <p style={{ flex: 1, fontSize: 13, fontWeight: fw.medium, lineHeight: 'var(--leading-body)', color: 'var(--text-1)', textWrap: 'pretty' }}>
          {redigeChance(c, t, teamA, teamB)}
        </p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 10 }}>
        <BarraDeChance label={t.resBefore} pct={c.fromPct} tone="var(--text-faint)" valueColor="var(--text-2)" />
        <BarraDeChance label={t.resAfter} pct={c.toPct} tone="var(--lime)" valueColor="var(--lime)" />
      </div>
    </div>
  );
}

type LinhaDeStat = { chave: string; label: string; a: number; b: number; aFlex: number; bFlex: number };

function linhasDeStats(totals: SalaTotais, rotulos: Record<string, string>): LinhaDeStat[] {
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

function Escudo({ nome }: { nome: string }) {
  return (
    <div
      style={{
        width: 38,
        height: 26,
        borderRadius: 'var(--r-sm)',
        background: 'var(--surface-1)',
        border: '1px solid var(--border-2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 11,
        fontWeight: fw.black,
        letterSpacing: 0.5,
        color: 'var(--text-2)',
      }}
    >
      {nome.slice(0, 3).toUpperCase()}
    </div>
  );
}

function useSegundos(fechaEm: number | null): number {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (fechaEm == null) return;
    // The countdown is cosmetic; the server remains authoritative for closure.
    const tick = () => setSecs(Math.max(0, Math.ceil((fechaEm - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [fechaEm]);
  return secs;
}

function CardDoDesafio({
  d,
  onResponder,
  enviando,
  recusa,
  treino,
  teamA,
  teamB,
}: {
  d: SalaDesafio;
  onResponder: (optionId: string) => void;
  enviando: boolean;
  recusa: string | null;
  treino: boolean;
  teamA: string;
  teamB: string;
}) {
  const { t } = useI18n();
  const secs = useSegundos(d.fechaEm);
  const rotulo: Record<string, string> = {
    next_goal: t.qNextGoal,
    hilo_corners: t.qHiloCorners,
    final_result: t.qFinalResult,
  };
  const respondido = d.minhaEscolha !== null;

  return (
    <div
      style={{
        padding: '14px 14px 16px',
        borderRadius: 'var(--r-xl)',
        background: 'var(--surface-1)',
        border: `1px solid ${respondido ? 'var(--lime-line)' : 'var(--border-2)'}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 10.5, fontWeight: fw.black, letterSpacing: 1, color: 'var(--lime)' }}>
          {rotulo[d.type] ?? t.salaChallenge} · {treino ? t.treinoTag : `+${d.xp} XP`}
        </span>
        <span style={{ fontSize: 12, fontWeight: fw.black, color: d.fechado ? 'var(--text-muted)' : secs <= 3 ? 'var(--red)' : 'var(--text-2)' }}>
          {d.fechado ? t.salaClosedWindow : `${secs}s`}
        </span>
      </div>

      <p style={{ fontSize: 16, fontWeight: fw.heavy, marginTop: 8, textWrap: 'pretty' }}>
        {textoDaPergunta(d.type, d.prompt, t, teamA, teamB)}
      </p>

      {respondido ? (
        <div
          style={{
            marginTop: 12,
            padding: '10px 12px',
            borderRadius: 'var(--r-md)',
            background: 'var(--lime-a10)',
            border: '1px solid var(--lime-line)',
          }}
        >
          <div style={{ fontSize: 12.5, fontWeight: fw.black, color: 'var(--lime)' }}>
            {t.salaSent} · {rotuloDaOpcao(d.minhaEscolha ?? '', t, teamA, teamB, d.options)}
          </div>
          <div style={{ fontSize: 11.5, fontWeight: fw.medium, color: 'var(--text-2)', marginTop: 2 }}>
            {t.salaWaitingPlay}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          {d.options.map((o) => (
            <Button key={o.id} variant="ghost" full disabled={enviando} onClick={() => onResponder(o.id)}>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  width: '100%',
                }}
              >
                <span>{rotuloDaOpcao(o.id, t, teamA, teamB, d.options)}</span>
                {typeof o.pct === 'number' && (
                  <span style={{ fontSize: 12.5, fontWeight: fw.heavy, color: 'var(--text-muted)' }}>
                    {Math.round(o.pct)}%
                  </span>
                )}
              </span>
            </Button>
          ))}
        </div>
      )}

      {recusa && (
        <p role="alert" style={{ marginTop: 10, fontSize: 12, fontWeight: fw.bold, color: 'var(--red)', textAlign: 'center' }}>
          {recusa}
        </p>
      )}
    </div>
  );
}

function ResumoDaPartida({
  teamA,
  teamB,
  score,
  resultados,
  rankingCount,
  chancesCount,
  stats,
  onBack,
  onHome,
}: {
  teamA: string;
  teamB: string;
  score: { p1: number; p2: number };
  resultados: SalaResultado[];
  rankingCount: number;
  chancesCount: number;
  stats: LinhaDeStat[];
  onBack: () => void;
  onHome: () => void;
}) {
  const { t } = useI18n();
  const summary = calcularResumoDaSala(resultados, rankingCount, chancesCount);
  const cards = [
    { value: String(summary.picks), label: t.summaryPicks },
    { value: String(summary.hits), label: t.summaryHits },
    { value: String(summary.players), label: t.summaryPlayers },
    { value: String(summary.movements), label: t.summaryMovements },
  ];

  return (
    <Screen padding="18px 20px 24px" style={{ display: 'flex', flexDirection: 'column' }}>
      <button
        onClick={onBack}
        aria-label={t.summaryBack}
        style={{ all: 'unset', cursor: 'pointer', width: 38, height: 38, display: 'grid', placeItems: 'center', borderRadius: 'var(--r-lg)', background: 'var(--surface-1)' }}
      >
        <ChevronLeft />
      </button>
      <div style={{ textAlign: 'center', marginTop: 12 }}>
        <Badge tone="neutral">{t.lanceEnd}</Badge>
        <div style={{ marginTop: 15, fontSize: 11, fontWeight: fw.black, letterSpacing: 1.2, color: 'var(--text-muted)' }}>
          {t.summaryTitle}
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
      <Button full size="lg" onClick={onBack}>{t.summaryBack}</Button>
      <Button full variant="ghost" onClick={onHome}>{t.backHome}</Button>
    </Screen>
  );
}

export function SalaReal({
  fixtureId,
  partyId,
  lobbyPlayerCount,
  lobbyPlayers,
  onLeaveLobby,
}: {
  fixtureId: string;
  partyId: string;
  lobbyPlayerCount: number;
  lobbyPlayers: LobbyState['players'];
  onLeaveLobby: () => Promise<void>;
}) {
  const router = useRouter();
  const { t, fmt, lang } = useI18n();
  const { session, addXp } = useSession();
  const privy = usePrivyAuth();
  const {
    state,
    desafios,
    resultados,
    ranking,
    chances,
    erro,
    training: treino,
    segundosVivos,
    palpitar,
  } = useSala(fixtureId, partyId, privy.ready && privy.authenticated, addXp);

  const [tab, setTab] = useState<SalaTab>('desafios');
  const [enviando, setEnviando] = useState<string | null>(null);
  const [recusa, setRecusa] = useState<Record<string, string>>({});
  const [confirmandoSaida, setConfirmandoSaida] = useState(false);
  const [detalhe, setDetalhe] = useState<SalaResultado | null>(null);
  const [resumoAberto, setResumoAberto] = useState(false);
  const saidaEmAndamento = useRef(false);

  const sairDaSala = async () => {
    if (saidaEmAndamento.current) return;
    saidaEmAndamento.current = true;
    try {
      await onLeaveLobby();
    } catch {
    } finally {
      router.push('/home');
    }
  };


  const stats = useMemo(
    () => (state ? linhasDeStats(state.totals, t.statKeys) : []),
    [state?.totals, t.statKeys],
  );
  const rankingComPresenca = useMemo(() => {
    const presencaPorNome = new Map(lobbyPlayers.map((player) => [player.name, player]));
    const rows = ranking.map((row) => ({
      ...row,
      presence: presencaPorNome.get(row.name)?.presence ?? ('away' as const),
    }));
    const nomesNoRanking = new Set(ranking.map((row) => row.name));
    for (const player of lobbyPlayers) {
      if (!nomesNoRanking.has(player.name)) {
        rows.push({ name: player.name, xp: 0, me: player.me, presence: player.presence });
      }
    }
    return rows;
  }, [lobbyPlayers, ranking]);

  const responder = async (questionId: string, optionId: string) => {
    if (enviando) return;
    setEnviando(questionId);
    const r = await palpitar(questionId, optionId);
    setEnviando(null);
    if (!r.ok) setRecusa((p) => ({ ...p, [questionId]: r.error ?? '' }));
  };

  const esperandoIlha = !privy.ready || !privy.authenticated;
  if (erro && !state && !esperandoIlha) {
    return (
      <Screen padding="20px 18px">
        <p role="alert" style={{ color: 'var(--red)', fontSize: 13, fontWeight: fw.bold, textAlign: 'center' }}>
          {erro}
        </p>
      </Screen>
    );
  }

  if (!state || !session) {
    return (
      <Screen padding="20px 18px">
        <p style={{ color: 'var(--text-muted)', fontSize: 13, fontWeight: fw.medium, textAlign: 'center' }}>
          {t.salaLoading}
        </p>
      </Screen>
    );
  }

  const teamA = localizeTeamName(state.teamA, lang);
  const teamB = localizeTeamName(state.teamB, lang);

  const selo = state.source === 'txline-live' ? t.srcTxline : t.srcReplay;
  const abertos = desafios.filter((d) => d.minhaEscolha === null && !d.fechado).length;
  const noOverlay = desafios.filter((d) => d.minhaEscolha === null && !d.fechado).at(-1) ?? null;

  if (resumoAberto) {
    return (
      <ResumoDaPartida
        teamA={teamA}
        teamB={teamB}
        score={state.score}
        resultados={resultados}
        rankingCount={Math.max(ranking.length, lobbyPlayerCount)}
        chancesCount={chances.length}
        stats={stats}
        onBack={() => setResumoAberto(false)}
        onHome={() => void sairDaSala()}
      />
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
      <div
        style={{
          flex: 'none',
          padding: '12px 18px 14px',
          background: 'linear-gradient(180deg, var(--surface-header), var(--bg-app))',
          borderBottom: '1px solid var(--border-1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button
            onClick={() => (state.finished ? void sairDaSala() : setConfirmandoSaida(true))}
            aria-label={t.backHome}
            style={{
              all: 'unset',
              cursor: 'pointer',
              width: 34,
              height: 34,
              borderRadius: 'var(--r-md)',
              background: 'var(--surface-1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ChevronLeft size={18} />
          </button>
          <Badge tone={state.finished ? 'neutral' : 'live'} dot={!state.finished}>
            {state.finished
              ? t.lanceEnd
              : `${t.replayShort} · ${formataRelogio(
                  Math.max(segundosVivos ?? 0, (state.minute ?? 0) * 60),
                )}`}
          </Badge>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: fw.heavy, color: 'var(--gold)' }}>
            <Star />
            {fmt(session.xp)} XP
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, padding: '0 6px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 96 }}>
            <Escudo nome={teamA} />
            <span style={{ fontWeight: fw.heavy, fontSize: 13.5, textAlign: 'center' }}>{teamA}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontWeight: fw.black, fontSize: 40, fontStyle: 'italic', letterSpacing: -2, lineHeight: 1 }}>
              {state.score.p1} – {state.score.p2}
            </span>
            <span style={{ fontSize: 10, fontWeight: fw.heavy, letterSpacing: 0.8, color: 'var(--text-muted)', marginTop: 4 }}>
              {selo}
            </span>
            {treino && (
              <span style={{ fontSize: 10, fontWeight: fw.black, letterSpacing: 0.8, color: 'var(--orange)', marginTop: 3 }}>
                {t.treinoSelo}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 96 }}>
            <Escudo nome={teamB} />
            <span style={{ fontWeight: fw.heavy, fontSize: 13.5, textAlign: 'center' }}>{teamB}</span>
          </div>
        </div>
      </div>

      {state.finished && (
        <div style={{ flex: 'none', padding: '12px 18px 0' }}>
          <Button full size="lg" onClick={() => setResumoAberto(true)}>
            {t.summaryOpen}
          </Button>
        </div>
      )}

      <div
        style={{
          flex: 'none',
          padding: '12px 18px 0',
          overflowX: 'auto',
          scrollbarWidth: 'none',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <SegTabs
          tabs={[
            { label: abertos ? `${t.salaTabChallenges} (${abertos})` : t.salaTabChallenges, value: 'desafios' },
            { label: t.salaTabPlays, value: 'lances' },
            { label: t.salaTabStats, value: 'stats' },
            { label: t.salaTabChances, value: 'chances' },
            { label: t.salaTabRanking, value: 'ranking' },
          ]}
          value={tab}
          onChange={(v) => setTab(v as SalaTab)}
        />
      </div>

      <Screen padding={noOverlay ? '14px 18px 300px' : '14px 18px 24px'}>
        {tab === 'desafios' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {desafios.filter((d) => d.questionId !== noOverlay?.questionId).map((d) => (
              <CardDoDesafio
                key={d.questionId}
                d={d}
                treino={treino}
                teamA={teamA}
                teamB={teamB}
                enviando={enviando === d.questionId}
                recusa={recusa[d.questionId] ?? null}
                onResponder={(o) => responder(d.questionId, o)}
              />
            ))}

            {!desafios.length && (
              <p style={{ textAlign: 'center', padding: 28, fontSize: 13, fontWeight: fw.medium, lineHeight: 'var(--leading-body)', color: 'var(--text-muted)' }}>
                {t.salaNoChallenges}
              </p>
            )}

            {resultados.length > 0 && (
              <>
                <div style={{ fontSize: 10.5, fontWeight: fw.black, letterSpacing: 1, color: 'var(--text-muted)', marginTop: 10 }}>
                  {t.salaResultsHdr}
                </div>
                {resultados.map((r) => {
                  const acertou =
                    !r.voidReason &&
                    r.correctOptionId !== undefined &&
                    r.minhaEscolha === r.correctOptionId;
                  const rotuloTipo: Record<string, string> = {
                    next_goal: t.qNextGoal,
                    hilo_corners: t.qHiloCorners,
                    final_result: t.qFinalResult,
                  };
                  return (
                    <button
                      key={r.questionId}
                      onClick={() => setDetalhe(r)}
                      style={{
                        all: 'unset',
                        cursor: 'pointer',
                        boxSizing: 'border-box',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        width: '100%',
                        padding: '12px 14px',
                        borderRadius: 'var(--r-lg)',
                        background: acertou ? 'var(--lime-a06)' : 'var(--surface-1)',
                        border: `1px solid ${acertou ? 'var(--lime-line)' : 'var(--border-1)'}`,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 10, fontWeight: fw.black, letterSpacing: 1, color: 'var(--text-muted)' }}>
                          {(r.qtype && rotuloTipo[r.qtype]) ?? t.salaChallenge}
                        </div>
                        <div
                          style={{
                            fontSize: 13.5,
                            fontWeight: fw.black,
                            marginTop: 3,
                            color: r.voidReason
                              ? 'var(--text-muted)'
                              : acertou
                                ? 'var(--lime)'
                                : 'var(--text-1)',
                          }}
                        >
                          {r.voidReason
                            ? t.salaVoid
                            : acertou
                              ? r.gained > 0
                                ? `${t.salaHit} +${r.gained} XP`
                                : t.salaHitTreino
                              : t.salaMiss}
                        </div>
                      </div>
                      <ChevronRight />
                    </button>
                  );
                })}
              </>
            )}
          </div>
        )}

        {tab === 'lances' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {state.feed.map((l, i) => (
              <div
                key={`${l.action}-${l.minute}-${i}`}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 2px', borderBottom: '1px solid var(--border-1)' }}
              >
                <span style={{ fontSize: 11, fontWeight: fw.black, color: 'var(--lime)', minWidth: 34 }}>
                  {l.minute ?? 0}’
                </span>
                <span style={{ fontSize: 13.5, fontWeight: l.goals ? fw.heavy : fw.medium, color: l.goals ? 'var(--lime)' : 'var(--text-1)' }}>
                  {textoDoLance(l, t, teamA, teamB)}
                </span>
              </div>
            ))}
            {!state.feed.length && (
              <p style={{ textAlign: 'center', padding: 28, fontSize: 13, fontWeight: fw.medium, color: 'var(--text-muted)' }}>
                {t.salaWaitingKickoff}
              </p>
            )}
          </div>
        )}

        {tab === 'stats' &&
          (stats.length ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={{ fontWeight: fw.heavy, fontSize: 13, color: 'var(--text-1)' }}>{teamA}</span>
                <span style={{ fontSize: 10, fontWeight: fw.black, letterSpacing: 1, color: 'var(--text-faint)' }}>
                  {t.statsMatchHdr}
                </span>
                <span style={{ fontWeight: fw.heavy, fontSize: 13, color: 'var(--text-1)' }}>{teamB}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {stats.map((st) => (
                  <div key={st.chave}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontWeight: fw.black, fontSize: 14, color: 'var(--lime)' }}>{st.a}</span>
                      <span style={{ fontSize: 11, fontWeight: fw.heavy, letterSpacing: 0.5, color: 'var(--text-muted)' }}>
                        {st.label}
                      </span>
                      <span style={{ fontWeight: fw.black, fontSize: 14, color: 'var(--text-1)' }}>{st.b}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, height: 8 }}>
                      <div style={{ flex: st.aFlex, background: 'var(--lime)', borderRadius: '99px 4px 4px 99px' }} />
                      <div style={{ flex: st.bFlex, background: 'var(--surface-2)', borderRadius: '4px 99px 99px 4px' }} />
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p style={{ textAlign: 'center', padding: 28, fontSize: 13, fontWeight: fw.medium, lineHeight: 'var(--leading-body)', color: 'var(--text-muted)' }}>
              {t.salaStatsWaiting}
            </p>
          ))}
        {tab === 'chances' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {chances.map((c) => (
              <LinhaDeChance
                key={`${c.ts}-${c.priceName}`}
                c={c}
                teamA={teamA}
                teamB={teamB}
              />
            ))}
            {!chances.length && (
              <p style={{ textAlign: 'center', padding: 28, fontSize: 13, fontWeight: fw.medium, lineHeight: 'var(--leading-body)', color: 'var(--text-muted)' }}>
                {t.salaChancesEmpty}
              </p>
            )}
          </div>
        )}

        {tab === 'ranking' && (
          <>
            <div style={{ fontSize: 10, fontWeight: fw.black, letterSpacing: 1, color: 'var(--text-faint)', marginBottom: 10 }}>
              {t.roomRanking}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {rankingComPresenca.map((r, i) => {
                const pos = i + 1;
                const presenceLabel = r.presence === 'watching'
                  ? t.lobbyWatching
                  : r.presence === 'left'
                    ? t.lobbyLeft
                    : t.lobbyAway;
                return (
                  <div
                    key={`${r.name}-${i}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '12px 14px',
                      borderRadius: 'var(--r-lg)',
                      background: r.me ? 'var(--lime-a10)' : 'var(--surface-1)',
                      border: `1px solid ${r.me ? 'var(--lime-line)' : 'var(--border-1)'}`,
                    }}
                  >
                    <span style={{ fontWeight: fw.black, fontSize: 13, color: pos <= 3 ? 'var(--gold)' : 'var(--text-muted)', minWidth: 20 }}>
                      {pos}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        fontWeight: fw.bold,
                        fontSize: 14,
                        fontStyle: r.name ? 'normal' : 'italic',
                        color: r.me ? 'var(--lime)' : r.name ? 'var(--text-hi)' : 'var(--text-muted)',
                      }}
                    >
                      <span style={{ display: 'block' }}>{r.me ? t.you : r.name || t.salaNoHandle}</span>
                      <span style={{ display: 'block', marginTop: 2, fontSize: 10, fontStyle: 'normal', fontWeight: fw.medium, color: 'var(--text-muted)' }}>
                        {presenceLabel}
                      </span>
                    </span>
                    <span style={{ fontWeight: fw.heavy, fontSize: 13, color: 'var(--gold)' }}>
                      {fmt(r.xp)} XP
                    </span>
                  </div>
                );
              })}
            </div>
            {!rankingComPresenca.length && (
              <p style={{ textAlign: 'center', padding: 28, fontSize: 13, fontWeight: fw.medium, lineHeight: 'var(--leading-body)', color: 'var(--text-muted)' }}>
                {t.salaRankEmpty}
              </p>
            )}
          </>
        )}

      </Screen>

      {noOverlay && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            padding: '0 12px 12px',
            background: 'linear-gradient(180deg, transparent, var(--bg-app) 38%)',
            animation: 'fadeUp .3s cubic-bezier(.2,.7,.3,1) both',
          }}
        >
          <CardDoDesafio
            key={noOverlay.questionId}
            d={noOverlay}
            treino={treino}
            teamA={teamA}
            teamB={teamB}
            enviando={enviando === noOverlay.questionId}
            recusa={recusa[noOverlay.questionId] ?? null}
            onResponder={(o) => responder(noOverlay.questionId, o)}
          />
        </div>
      )}

      {detalhe && (
        <DetalheDoResultado
          r={detalhe}
          teamA={teamA}
          teamB={teamB}
          onVoltar={() => setDetalhe(null)}
        />
      )}

      {confirmandoSaida && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'color-mix(in srgb, var(--bg-app) 76%, transparent)',
            display: 'flex',
            alignItems: 'flex-end',
            padding: '0 12px 16px',
            animation: 'fadeUp .2s cubic-bezier(.2,.7,.3,1) both',
          }}
        >
          <div
            style={{
              width: '100%',
              background: 'var(--surface-1)',
              border: '1.5px solid var(--border-2)',
              borderRadius: 'var(--r-2xl)',
              padding: 16,
            }}
          >
            <div style={{ fontWeight: fw.black, fontStyle: 'italic', fontSize: 20, letterSpacing: -0.4 }}>
              {t.sairSalaTitulo}
            </div>
            <p style={{ fontSize: 13, fontWeight: fw.medium, lineHeight: 'var(--leading-body)', color: 'var(--text-2)', marginTop: 8, textWrap: 'pretty' }}>
              {t.sairSalaAviso}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
              <Button full onClick={() => setConfirmandoSaida(false)}>
                {t.sairSalaFica}
              </Button>
              <Button variant="ghost" full onClick={() => void sairDaSala()}>
                {t.sairSalaVai}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
