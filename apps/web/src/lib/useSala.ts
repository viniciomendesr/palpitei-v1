'use client';

/** Cliente SSE da sala: exibe estado autoritativo e mantém recibos locais. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { esperaDeReconexao } from '@/lib/reconexao';
import { limitarSegundoDoReplay, segundoDoReplay } from '@/lib/relogio';
import { idDaOpcaoChance } from '@/lib/chances';

/** Cap do contrato para a lista de leituras de chance — o mesmo do servidor. */
const CAP_DE_CHANCES = 60;

export type SalaOpcao = { id: string; label: string; pct: number | null };

export type SalaDesafio = {
  questionId: string;
  type: string;
  prompt: string;
  options: SalaOpcao[];
  xp: number;
  /** Fechamento em ms de relógio local, calculado pelo servidor. */
  fechaEm: number;
  /** O que EU escolhi. null = ainda não palpitei nesta. */
  minhaEscolha: string | null;
  /** Janela fechada, mas ainda aguardando o evento que a resolve. */
  fechado: boolean;
};

export type SalaLance = {
  minute: number | null;
  action: string;
  goals: { p1: number; p2: number } | null;
};

/** Totais acumulados do feed; o mapa é aberto porque as chaves variam por partida. */
export type SalaTotais = { p1: Record<string, number>; p2: Record<string, number> };

/** Leitura estruturada do `odds_explain`; a UI traduz campos, não inventa contexto. */
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
  /** Âncora do relógio (segundos de jogo do último evento com relógio). */
  clockSeconds?: number | null;
  /** Minutos de jogo por segundo real — 12 no replay padrão, 1 ao vivo. */
  replaySpeed?: number;
  /** Último relógio real da timeline; impede extrapolação depois do feed. */
  clockMaxSeconds?: number | null;
  finished: boolean;
  feed: SalaLance[];
  /** Vazio = a partida ainda não mandou total nenhum. Não é "tudo zero". */
  totals: SalaTotais;
  /** Leituras de chance, opcionais para compatibilidade com servidores antigos. */
  chances?: SalaChance[];
};

/** Linha de ranking da sala, sem identificadores internos de terceiros. */
export type SalaRankRow = { name: string; xp: number; me?: boolean };

/** O jogo no instante da liquidação — a matéria-prima da explicação. */
export type SalaFatos = {
  minute: number | null;
  score: { p1: number; p2: number };
  /** null = o Total não trazia a chave (ausente ≠ zero, G7). */
  corners: { p1: number; p2: number } | null;
};

export type SalaResultado = {
  questionId: string;
  prompt: string;
  /** O TIPO da pergunta — é ele que escolhe o texto e a explicação na tela. */
  qtype?: string;
  correctOptionId?: string;
  /** Anulada: o lance resolvedor chegou com a janela aberta. Sem XP, e é justo. */
  voidReason?: string;
  /** O XP que EU ganhei. O servidor é quem soma — a tela nunca. */
  gained: number;
  minhaEscolha: string | null;
  /** Rótulos das opções: o resultado fala por nome, nunca por id. */
  options?: { id: string; label: string }[];
  facts?: SalaFatos | null;
};

/** O que o servidor manda no primeiro pacote. */
type QuestionDoServidor = {
  id: string;
  type: string;
  prompt: string;
  options: { id: string; label: string; pct?: number | null }[];
  closesAt: number;
  state: string;
  /** O piso de XP, do motor — a mesma régua do question_open. */
  xp?: number;
  /** Quanto falta DE VERDADE, em ms reais, pelo relógio da sala. */
  closesInRealMs?: number;
};

/** O que os MEUS palpites já renderam, como o servidor os liquidou. */
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
  /** Leituras de chance, mais recente PRIMEIRO (cap 60 — o mesmo do servidor). */
  const [chances, setChances] = useState<SalaChance[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  /** Meus palpites valem XP? Apenas `treino-*` responde não. */
  const [treino, setTreino] = useState(false);
  /** Relógio interpolado a partir do último evento com clock. */
  const [segundosVivos, setSegundosVivos] = useState<number | null>(null);
  const ancora = useRef<{ game: number; realAt: number } | null>(null);
  const speedRef = useRef<number | null>(null);
  const clockMaxRef = useRef<number | null>(null);
  const acabouRef = useRef(false);
  /** O enunciado de cada pergunta, para o resultado poder dizer do que se tratava. */
  const enunciados = useRef<Map<string, string>>(new Map());
  const escolhas = useRef<Map<string, string>>(new Map());
  /** Ref evita reconectar o SSE e impede recontar resultados restaurados. */
  const onGanhoRef = useRef(onGanho);
  onGanhoRef.current = onGanho;

  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    let es: EventSource | null = null;
    /** No máximo um timer de reconexão. */
    let proxima: ReturnType<typeof setTimeout> | null = null;
    let tentativa = 0;
    /** Diferencia falha inicial de reconexão após estado válido. */
    let temEstado = false;
    /** Evita conexões concorrentes. */
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

    /** Reconecta manualmente para obter um Bearer renovado a cada conexão. */
    const conectar = async () => {
      if (!vivo || conectando) return;
      conectando = true;
      es?.close();
      es = null;
      // Falha ao obter token é transitória e entra no backoff.
      const token = await import('@/lib/api')
        .then((m) => m.getAuthToken())
        .catch(() => null);
      conectando = false;
      if (!vivo) return;
      if (!token) {
        if (!temEstado) setErro('sem sessão verificada');
        agendar();
        return;
      }

      es = new EventSource(
        `/api/rooms/${encodeURIComponent(fixtureId)}/stream?token=${encodeURIComponent(token)}&party=${encodeURIComponent(partyId)}`,
      );

      es.onopen = () => {
        // Uma conexão aberta reinicia o backoff.
        tentativa = 0;
      };

      const tirar = (id: string) => setDesafios((ds) => ds.filter((d) => d.questionId !== id));

      es.onmessage = (e) => {
        if (!vivo) return;
        const msg = JSON.parse(e.data) as Record<string, unknown> & { type: string };

        switch (msg.type) {
          case 'room_state': {
            // O pacote inteiro ressemeia a tela; reconexão não pode duplicar estado.
            temEstado = true;
            setErro(null);
            const s = msg.state as SalaState & { questions?: QuestionDoServidor[] };
            setTreino(Boolean(msg.treino));
            // A âncora permite que a tela entre com o relógio já em movimento.
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
              // O estado inicial já contém os totais acumulados.
              totals: s.totals ?? { p1: {}, p2: {} },
            });

            // Substitui leituras acumuladas para evitar duplicação na reconexão.
            setChances((s.chances ?? []).slice(0, CAP_DE_CHANCES));

            // Semeia recibos antes de montar perguntas para sobreviver a reload.
            const minhas = (msg.minhas ?? []) as { questionId: string; choice: string }[];
            for (const m of minhas) escolhas.current.set(m.questionId, m.choice);

            // Mantém janelas abertas e fechadas nas quais este fã já respondeu.
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
                    // O piso de XP vem do servidor.
                    xp: q.xp ?? 0,
                    // Fallback de compatibilidade para servidor sem prazo.
                    fechaEm: agora + (q.closesInRealMs ?? 60_000),
                    minhaEscolha: escolhas.current.get(q.id) ?? null,
                    fechado: q.state === 'closed',
                  };
                }),
            );

            // Restaura os resultados deste fã do mais recente para o mais antigo.
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
            // Evento sem clock preserva a âncora anterior.
            if (typeof msg.clockSeconds === 'number') {
              ancora.current = { game: msg.clockSeconds as number, realAt: Date.now() };
            }
            setState((p) =>
              p
                ? {
                    ...p,
                    // `null` significa placar não informado, nunca 0–0.
                    score: { p1: scoreA ?? p.score.p1, p2: scoreB ?? p.score.p2 },
                    minute: (msg.minute as number | null) ?? p.minute,
                    feed: [msg.lance as SalaLance, ...p.feed].slice(0, 40),
                    // O servidor já mesclou totais; ausência preserva o estado local.
                    totals: totais ?? p.totals,
                  }
                : p,
            );
            return;
          }

          case 'odds_explain': {
            // Mantém ordem, cap e deduplicação para reentregas do SSE.
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
            // Atualiza o percentual 1X2 sem transmitir cada tick de odds.
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
                // Sem palpite, não há recibo a manter.
                .filter((d) => d.questionId !== id || d.minhaEscolha !== null)
                // Quem respondeu permanece até a resolução.
                .map((d) => (d.questionId === id ? { ...d, fechado: true } : d)),
            );
            return;
          }

          case 'question_resolved':
          case 'question_void': {
            const id = msg.questionId as string;
            tirar(id);
            // Exibe resultado somente de pergunta respondida por este fã.
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
              // O contador acompanha o valor do motor; banco continua autoritativo.
              if (gained > 0) onGanhoRef.current?.(gained);
            }
            return;
          }

          case 'ranking': {
            // Ranking é ordenado e marcado pelo servidor autoritativo.
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
        // Nova conexão obtém token fresco; após estado válido, reconexão é silenciosa.
        es?.close();
        es = null;
        if (!vivo) return;
        if (!temEstado) setErro('a conexão com a sala caiu');
        agendar();
      };
    };

    /** Ao voltar do background, reabre uma conexão fechada sem esperar o timer. */
    const aoVoltar = () => {
      if (!vivo || conectando || document.visibilityState !== 'visible') return;
      // Conexões abertas ou em andamento não precisam de intervenção.
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

  // Atualiza o relógio em 250 ms e congela ao fim da partida.
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

  /** Envia o palpite ao servidor e atualiza apenas o recibo local. */
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
    treino,
    segundosVivos,
    palpitar,
  };
}
