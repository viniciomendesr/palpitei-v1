'use client';

/** Room SSE client: renders authoritative state and keeps local receipts. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { esperaDeReconexao } from '@/lib/reconexao';
import { limitarSegundoDoReplay, segundoDoReplay } from '@/lib/relogio';
import { idDaOpcaoChance } from '@/lib/chances';

/** Server contract cap for chance readings. */
const CAP_DE_CHANCES = 60;

export type SalaOpcao = { id: string; label: string; pct: number | null };

export type SalaDesafio = {
  questionId: string;
  type: string;
  prompt: string;
  options: SalaOpcao[];
  xp: number;
  /** Local-clock deadline calculated by the server. */
  fechaEm: number;
  /** Current user's choice; `null` means unanswered. */
  minhaEscolha: string | null;
  /** Window closed while awaiting the resolving event. */
  fechado: boolean;
};

export type SalaLance = {
  minute: number | null;
  action: string;
  goals: { p1: number; p2: number } | null;
};

/** Accumulated feed totals; keys vary by fixture. */
export type SalaTotais = { p1: Record<string, number>; p2: Record<string, number> };

/** Structured `odds_explain` reading; UI renders fields without inventing context. */
export type SalaChance = {
  id: string;
  ts: number;
  minute: number | null;
  priceName: string;
  fromPct: number;
  toPct: number;
  contextAction?: string;
  text: string;
};

export type SalaState = {
  fixtureId: number;
  teamA: string;
  teamB: string;
  source: string;
  score: { p1: number; p2: number };
  minute: number | null;
  /** Clock anchor from the most recent event carrying a game clock. */
  clockSeconds?: number | null;
  /** Game minutes per real second: standard replay is 12, live is 1. */
  replaySpeed?: number;
  /** Last real timeline clock; prevents extrapolation beyond the feed. */
  clockMaxSeconds?: number | null;
  finished: boolean;
  feed: SalaLance[];
  /** Empty means no totals have arrived, not that every total is zero. */
  totals: SalaTotais;
  /** Optional chance readings for compatibility with older servers. */
  chances?: SalaChance[];
};

/** Room ranking row without third-party internal identifiers. */
export type SalaRankRow = { name: string; xp: number; me?: boolean };

/** Game facts at settlement time, used for the explanation. */
export type SalaFatos = {
  minute: number | null;
  score: { p1: number; p2: number };
  /** `null` means the feed did not include this total key. */
  corners: { p1: number; p2: number } | null;
};

export type SalaResultado = {
  questionId: string;
  prompt: string;
  /** Question type selects the UI copy and explanation. */
  qtype?: string;
  correctOptionId?: string;
  /** Present when the resolving event arrived while the window was open; no XP is awarded. */
  voidReason?: string;
  /** XP awarded to the current user by the server. */
  gained: number;
  minhaEscolha: string | null;
  /** Option labels allow results to render names instead of IDs. */
  options?: { id: string; label: string }[];
  facts?: SalaFatos | null;
};

/** Question shape included in the initial server packet. */
type QuestionDoServidor = {
  id: string;
  type: string;
  prompt: string;
  options: { id: string; label: string; pct?: number | null }[];
  closesAt: number;
  state: string;
  /** Base XP from the engine, matching `question_open`. */
  xp?: number;
  /** Remaining real milliseconds from the authoritative room clock. */
  closesInRealMs?: number;
};

/** Current user's settled prediction result. */
type ResultadoDoServidor = {
  questionId: string;
  prompt: string;
  qtype?: string;
  correctOptionId?: string;
  voidReason?: string;
  gained: number;
  choice: string;
  options?: { id: string; label: string }[];
  facts?: SalaFatos | null;
};

export function useSala(
  fixtureId: string,
  partyId: string,
  ativo: boolean,
  onGanho?: (xp: number) => void,
) {
  const [state, setState] = useState<SalaState | null>(null);
  const [desafios, setDesafios] = useState<SalaDesafio[]>([]);
  const [resultados, setResultados] = useState<SalaResultado[]>([]);
  const [ranking, setRanking] = useState<SalaRankRow[]>([]);
  /** Chance readings, newest first, capped to the server limit. */
  const [chances, setChances] = useState<SalaChance[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  /** Training rooms do not award XP. */
  const [training, setTraining] = useState(false);
  /** Clock interpolated from the latest event carrying a clock. */
  const [segundosVivos, setSegundosVivos] = useState<number | null>(null);
  const ancora = useRef<{ game: number; realAt: number } | null>(null);
  const speedRef = useRef<number | null>(null);
  const clockMaxRef = useRef<number | null>(null);
  const acabouRef = useRef(false);
  /** Prompts retained so settled results can identify their question. */
  const enunciados = useRef<Map<string, string>>(new Map());
  const escolhas = useRef<Map<string, string>>(new Map());
  /** Ref avoids reconnecting SSE and recounting restored results. */
  const onGanhoRef = useRef(onGanho);
  onGanhoRef.current = onGanho;

  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    let es: EventSource | null = null;
    /** At most one reconnection timer. */
    let proxima: ReturnType<typeof setTimeout> | null = null;
    let tentativa = 0;
    /** Distinguishes initial failure from reconnection after valid state. */
    let temEstado = false;
    /** Prevents concurrent connections. */
    let conectando = false;

    const agendar = () => {
      if (!vivo || proxima) return;
      const espera = esperaDeReconexao(tentativa);
      tentativa += 1;
      proxima = setTimeout(() => {
        proxima = null;
        void conectar();
      }, espera);
    };

    /** Fetches a fresh SSE ticket for every connection. */
    const conectar = async () => {
      if (!vivo || conectando) return;
      conectando = true;
      es?.close();
      es = null;
      // Exchange the Bearer token for a short-lived URL ticket; retry transient failures with backoff.
      const ticket = await import('@/lib/api')
        .then((m) => m.api.sseTicket(fixtureId, partyId, 'room'))
        .then((response) => response.ticket)
        .catch(() => null);
      conectando = false;
      if (!vivo) return;
      if (!ticket) {
        if (!temEstado) setErro('sem sessão verificada');
        agendar();
        return;
      }

      es = new EventSource(
        `/api/rooms/${encodeURIComponent(fixtureId)}/stream?ticket=${encodeURIComponent(ticket)}&party=${encodeURIComponent(partyId)}`,
      );

      es.onopen = () => {
        // A successful connection resets backoff.
        tentativa = 0;
      };

      const tirar = (id: string) => setDesafios((ds) => ds.filter((d) => d.questionId !== id));

      es.onmessage = (e) => {
        if (!vivo) return;
        const msg = JSON.parse(e.data) as Record<string, unknown> & { type: string };

        switch (msg.type) {
          case 'room_state': {
            // The full packet reseeds UI state so reconnection cannot duplicate it.
            temEstado = true;
            setErro(null);
            const s = msg.state as SalaState & { questions?: QuestionDoServidor[] };
            setTraining(Boolean(msg.training));
            // Anchor the clock immediately when joining mid-match.
            if (typeof s.clockSeconds === 'number') {
              ancora.current = { game: s.clockSeconds, realAt: Date.now() };
            }
            if (typeof s.replaySpeed === 'number') speedRef.current = s.replaySpeed;
            clockMaxRef.current = typeof s.clockMaxSeconds === 'number' ? s.clockMaxSeconds : null;
            acabouRef.current = s.finished;
            setState({
              fixtureId: s.fixtureId,
              teamA: s.teamA,
              teamB: s.teamB,
              source: s.source,
              score: s.score,
              minute: s.minute,
              finished: s.finished,
              feed: s.feed ?? [],
              // Initial state already contains accumulated totals.
              totals: s.totals ?? { p1: {}, p2: {} },
            });

            // Replace accumulated readings to avoid duplication after reconnection.
            setChances((s.chances ?? []).slice(0, CAP_DE_CHANCES));

            // Seed receipts before questions so they survive reloads.
            const minhas = (msg.minhas ?? []) as { questionId: string; choice: string }[];
            for (const m of minhas) escolhas.current.set(m.questionId, m.choice);

            // Retain open questions and closed questions already answered by this user.
            const agora = Date.now();
            setDesafios(
              (s.questions ?? [])
                .filter(
                  (q) => q.state === 'open' || (q.state === 'closed' && escolhas.current.has(q.id)),
                )
                .map((q) => {
                  enunciados.current.set(q.id, q.prompt);
                  return {
                    questionId: q.id,
                    type: q.type,
                    prompt: q.prompt,
                    options: q.options.map((o) => ({ id: o.id, label: o.label, pct: o.pct ?? null })),
                    // Base XP comes from the server.
                    xp: q.xp ?? 0,
                    // Compatibility fallback for servers without a deadline.
                    fechaEm: agora + (q.closesInRealMs ?? 60_000),
                    minhaEscolha: escolhas.current.get(q.id) ?? null,
                    fechado: q.state === 'closed',
                  };
                }),
            );

            // Restore this user's results from newest to oldest.
            const liquidados = (msg.resultados ?? []) as ResultadoDoServidor[];
            for (const r of liquidados) enunciados.current.set(r.questionId, r.prompt);
            setResultados(
              liquidados.map((r) => ({
                questionId: r.questionId,
                prompt: r.prompt,
                qtype: r.qtype,
                correctOptionId: r.correctOptionId,
                voidReason: r.voidReason,
                gained: r.gained,
                minhaEscolha: r.choice,
                options: r.options,
                facts: r.facts ?? null,
              })),
            );
            return;
          }

          case 'score_event': {
            const scoreA = msg.scoreA as number | null;
            const scoreB = msg.scoreB as number | null;
            const totais = msg.totals as SalaTotais | undefined;
            // Events without a clock retain the previous anchor.
            if (typeof msg.clockSeconds === 'number') {
              ancora.current = { game: msg.clockSeconds as number, realAt: Date.now() };
            }
            setState((p) =>
              p
                ? {
                    ...p,
                    // `null` means score not provided, never 0–0.
                    score: { p1: scoreA ?? p.score.p1, p2: scoreB ?? p.score.p2 },
                    minute: (msg.minute as number | null) ?? p.minute,
                    feed: [msg.lance as SalaLance, ...p.feed].slice(0, 40),
                    // Server totals are merged; absence preserves local state.
                    totals: totais ?? p.totals,
                  }
                : p,
            );
            return;
          }

          case 'odds_explain': {
            // Preserve order, cap, and deduplication for redelivered SSE events.
            const nova: SalaChance = {
              id: String(msg.id ?? `${String(msg.ts)}:${String(msg.priceName)}:${String(msg.fromPct)}:${String(msg.toPct)}`),
              ts: msg.ts as number,
              minute: (msg.minute as number | null) ?? null,
              priceName: msg.priceName as string,
              fromPct: msg.fromPct as number,
              toPct: msg.toPct as number,
              contextAction: msg.contextAction as string | undefined,
              text: (msg.text as string) ?? '',
            };
            // Update 1X2 percentages without broadcasting every odds tick.
            const optionId = idDaOpcaoChance(nova.priceName);
            if (optionId) {
              setDesafios((ds) =>
                ds.map((d) =>
                  d.type === 'final_result'
                    ? {
                        ...d,
                        options: d.options.map((o) =>
                          o.id === optionId ? { ...o, pct: nova.toPct } : o,
                        ),
                      }
                    : d,
                ),
              );
            }
            setChances((cs) =>
              cs.some((c) => c.id === nova.id)
                ? cs
                : [nova, ...cs].slice(0, CAP_DE_CHANCES),
            );
            return;
          }

          case 'question_open': {
            const id = msg.questionId as string;
            enunciados.current.set(id, msg.prompt as string);
            setDesafios((ds) => [
              ...ds.filter((d) => d.questionId !== id),
              {
                questionId: id,
                type: (msg.qtype as string) ?? '',
                prompt: msg.prompt as string,
                options: msg.options as SalaOpcao[],
                xp: (msg.xp as number) ?? 0,
                fechaEm: Date.now() + ((msg.closesInRealMs as number) ?? 0),
                minhaEscolha: escolhas.current.get(id) ?? null,
                fechado: false,
              },
            ]);
            return;
          }

          case 'question_closed': {
            const id = msg.questionId as string;
            setDesafios((ds) =>
              ds
                // Unanswered questions have no receipt to retain.
                .filter((d) => d.questionId !== id || d.minhaEscolha !== null)
                // Answered questions remain until settlement.
                .map((d) => (d.questionId === id ? { ...d, fechado: true } : d)),
            );
            return;
          }

          case 'question_resolved':
          case 'question_void': {
            const id = msg.questionId as string;
            tirar(id);
            // Only show results for questions answered by this user.
            if (escolhas.current.has(id)) {
              const gained = (msg.gained as number) ?? 0;
              setResultados((rs) => [
                {
                  questionId: id,
                  prompt: enunciados.current.get(id) ?? '',
                  qtype: msg.qtype as string | undefined,
                  correctOptionId: msg.correctOptionId as string | undefined,
                  voidReason: msg.reason as string | undefined,
                  gained,
                  minhaEscolha: escolhas.current.get(id) ?? null,
                  options: msg.options as { id: string; label: string }[] | undefined,
                  facts: (msg.facts as SalaFatos | null) ?? null,
                },
                ...rs,
              ]);
              // Counter follows the engine value; the database remains authoritative.
              if (gained > 0) onGanhoRef.current?.(gained);
            }
            return;
          }

          case 'ranking': {
            // Ranking order and current-user marker are server-authoritative.
            setRanking(msg.rows as SalaRankRow[]);
            return;
          }

          case 'game_end':
          case 'replay_done': {
            acabouRef.current = true;
            setState((p) => (p ? { ...p, finished: true } : p));
            setDesafios([]);
            return;
          }
        }
      };

      es.onerror = () => {
        // Each reconnection uses a fresh ticket; after valid state, retry silently.
        es?.close();
        es = null;
        if (!vivo) return;
        if (!temEstado) setErro('a conexão com a sala caiu');
        agendar();
      };
    };

    /** Reopens a closed connection after returning from background without waiting for the timer. */
    const aoVoltar = () => {
      if (!vivo || conectando || document.visibilityState !== 'visible') return;
      // Open or in-flight connections need no intervention.
      if (es && es.readyState !== EventSource.CLOSED) return;
      if (proxima) {
        clearTimeout(proxima);
        proxima = null;
      }
      tentativa = 0;
      void conectar();
    };

    void conectar();
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('pageshow', aoVoltar);

    return () => {
      vivo = false;
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('pageshow', aoVoltar);
      if (proxima) clearTimeout(proxima);
      es?.close();
    };
  }, [fixtureId, partyId, ativo]);

  // Update the clock every 250 ms and freeze it after the fixture ends.
  useEffect(() => {
    if (!ativo) return;
    const tick = () => {
      if (acabouRef.current || !ancora.current || speedRef.current === null) return;
      const interpolado = segundoDoReplay(
        ancora.current.game,
        ancora.current.realAt,
        speedRef.current,
        Date.now(),
      );
      const s = limitarSegundoDoReplay(interpolado, clockMaxRef.current);
      setSegundosVivos((antes) => (antes === s ? antes : s));
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [ativo, fixtureId, partyId]);

  /** Sends a prediction to the server and updates only the local receipt. */
  const palpitar = useCallback(
    async (questionId: string, optionId: string): Promise<{ ok: boolean; error?: string }> => {
      const { api } = await import('@/lib/api');
      try {
        await api.predict(fixtureId, partyId, { questionId, optionId });
        escolhas.current.set(questionId, optionId);
        setDesafios((ds) =>
          ds.map((d) => (d.questionId === questionId ? { ...d, minhaEscolha: optionId } : d)),
        );
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'não deu para palpitar' };
      }
    },
    [fixtureId, partyId],
  );

  return {
    state,
    desafios,
    resultados,
    ranking,
    chances,
    erro,
    training,
    segundosVivos,
    palpitar,
  };
}
