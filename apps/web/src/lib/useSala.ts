'use client';

/**
 * A sala real, por SSE. O oposto da sala do mock — e a inversão é o ponto.
 *
 * No mock o motor mora DENTRO do componente: `const correct = optId ===
 * spec.correct`. Aqui quem decide é o SERVIDOR, sempre: ele abre a pergunta,
 * fecha a janela pelo relógio do FEED e diz quem acertou. Este hook só escuta e
 * mostra. Cliente que decide o próprio XP é fraude de um curl (CONTEXT §4).
 *
 * ─── por que os desafios são uma LISTA ───
 *
 * `engine.openQuestions()` devolve um array, e não é enfeite: o motor abre
 * "quem marca o próximo gol?" e "sai outro escanteio em 10 min?" ao mesmo tempo,
 * e as janelas se sobrepõem. A primeira versão disto guardava UM desafio (o
 * último `question_open`) — os outros sumiam da tela sem deixar rastro, e o fã
 * perdia XP que estava aberto na frente dele.
 *
 * ─── por que `minhaEscolha` vive aqui ───
 *
 * O servidor só fala de novo quando a pergunta RESOLVE, e isso pode levar
 * minutos de jogo. Entre o toque e o lance, a tela precisa dizer "registrei" —
 * senão o fã toca e não acontece nada. Isto NÃO é o motor: é o recibo do que eu
 * mandei. Quem julga continua sendo o servidor.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type SalaOpcao = { id: string; label: string; pct: number | null };

export type SalaDesafio = {
  questionId: string;
  type: string;
  prompt: string;
  options: SalaOpcao[];
  xp: number;
  /** Quando a janela fecha, em ms REAIS de relógio local. O Clock do servidor
   *  converteu tempo de jogo → tempo real; aqui só se conta o tempo que passou. */
  fechaEm: number;
  /** O que EU escolhi. null = ainda não palpitei nesta. */
  minhaEscolha: string | null;
  /**
   * A janela fechou, mas o lance que resolve ainda não chegou.
   *
   * Existe porque o `question_closed` removia o desafio da lista, e o meu
   * palpite sumia da tela junto: entre fechar e resolver passam MINUTOS de jogo,
   * e nesse intervalo o fã não tinha rastro nenhum do que tinha respondido —
   * exatamente a queixa de "eu respondo e a tela não reage", só que mais tarde.
   */
  fechado: boolean;
};

export type SalaLance = {
  minute: number | null;
  action: string;
  goals: { p1: number; p2: number } | null;
};

/**
 * Os totais do bloco `Score.Total`, como o servidor os acumulou. Mapa ABERTO,
 * não um registro de campos conhecidos: o conjunto de chaves varia por partida
 * (England × Argentina traz só Goals/Corners/YellowCards — nem Shots, nem posse
 * de bola). Quem tipar isto com uma lista fixa volta a inventar linha.
 */
export type SalaTotais = { p1: Record<string, number>; p2: Record<string, number> };

export type SalaState = {
  fixtureId: number;
  teamA: string;
  teamB: string;
  source: string;
  score: { p1: number; p2: number };
  minute: number | null;
  finished: boolean;
  feed: SalaLance[];
  /** Vazio = a partida ainda não mandou total nenhum. Não é "tudo zero". */
  totals: SalaTotais;
};

/**
 * Uma linha do ranking DA SALA (XP desta partida, não o global).
 *
 * `name` vazio = o fã ainda não escolheu apelido. É o que o servidor sabe, e a
 * tela tem que dizer isso — nunca preencher com um nome inventado (E12).
 * Não há userId aqui: o servidor não manda o id interno de terceiros.
 */
export type SalaRankRow = { name: string; xp: number; me?: boolean };

export type SalaResultado = {
  questionId: string;
  prompt: string;
  correctOptionId?: string;
  /** Anulada: o lance resolvedor chegou com a janela aberta. Sem XP, e é justo. */
  voidReason?: string;
  /** O XP que EU ganhei. O servidor é quem soma — a tela nunca. */
  gained: number;
  minhaEscolha: string | null;
};

/** O que o servidor manda no primeiro pacote. */
type QuestionDoServidor = {
  id: string;
  type: string;
  prompt: string;
  options: { id: string; label: string }[];
  closesAt: number;
  state: string;
};

export function useSala(fixtureId: string, ativo: boolean) {
  const [state, setState] = useState<SalaState | null>(null);
  const [desafios, setDesafios] = useState<SalaDesafio[]>([]);
  const [resultados, setResultados] = useState<SalaResultado[]>([]);
  const [ranking, setRanking] = useState<SalaRankRow[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  /** O enunciado de cada pergunta, para o resultado poder dizer do que se tratava. */
  const enunciados = useRef<Map<string, string>>(new Map());
  const escolhas = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    let es: EventSource | null = null;

    (async () => {
      const { getAuthToken } = await import('@/lib/api');
      const token = await getAuthToken();
      if (!vivo) return;
      if (!token) {
        setErro('sem sessão verificada');
        return;
      }

      es = new EventSource(
        `/api/rooms/${encodeURIComponent(fixtureId)}/stream?token=${encodeURIComponent(token)}`,
      );

      const tirar = (id: string) => setDesafios((ds) => ds.filter((d) => d.questionId !== id));

      es.onmessage = (e) => {
        if (!vivo) return;
        const msg = JSON.parse(e.data) as Record<string, unknown> & { type: string };

        switch (msg.type) {
          case 'room_state': {
            const s = msg.state as SalaState & { questions?: QuestionDoServidor[] };
            setState({
              fixtureId: s.fixtureId,
              teamA: s.teamA,
              teamB: s.teamB,
              source: s.source,
              score: s.score,
              minute: s.minute,
              finished: s.finished,
              feed: s.feed ?? [],
              // Quem chega no meio do jogo já pega os totais acumulados da sala.
              totals: s.totals ?? { p1: {}, p2: {} },
            });
            // Quem chega no meio do jogo pega TODAS as janelas já abertas — não
            // só a próxima a abrir.
            const agora = Date.now();
            setDesafios(
              (s.questions ?? [])
                .filter((q) => q.state === 'open')
                .map((q) => {
                  enunciados.current.set(q.id, q.prompt);
                  return {
                    questionId: q.id,
                    type: q.type,
                    prompt: q.prompt,
                    options: q.options.map((o) => ({ ...o, pct: null })),
                    xp: 0,
                    // Sem closesInRealMs no estado inicial, o prazo é desconhecido:
                    // 0 aqui esconderia o desafio. Dá um minuto e deixa o servidor
                    // corrigir no question_closed — que é quem manda.
                    fechaEm: agora + 60_000,
                    minhaEscolha: escolhas.current.get(q.id) ?? null,
                    fechado: false,
                  };
                }),
            );
            return;
          }

          case 'score_event': {
            const scoreA = msg.scoreA as number | null;
            const scoreB = msg.scoreB as number | null;
            const totais = msg.totals as SalaTotais | undefined;
            setState((p) =>
              p
                ? {
                    ...p,
                    // AUSENTE ≠ ZERO (A4). O servidor manda null quando o lance não
                    // mexeu no placar; `?? 0` faria o placar REGREDIR a 0–0.
                    score: { p1: scoreA ?? p.score.p1, p2: scoreB ?? p.score.p2 },
                    minute: (msg.minute as number | null) ?? p.minute,
                    feed: [msg.lance as SalaLance, ...p.feed].slice(0, 40),
                    // Troca direta: o que vem já é o acumulado do servidor, que é
                    // quem faz o merge por chave. Sem totais no pacote, fica o que
                    // já tinha — nunca `{}`, que apagaria a aba inteira.
                    totals: totais ?? p.totals,
                  }
                : p,
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
                // Quem NÃO palpitou não tem o que acompanhar: o card sai.
                .filter((d) => d.questionId !== id || d.minhaEscolha !== null)
                // Quem palpitou fica: o lance que resolve ainda não chegou.
                .map((d) => (d.questionId === id ? { ...d, fechado: true } : d)),
            );
            return;
          }

          case 'question_resolved':
          case 'question_void': {
            const id = msg.questionId as string;
            tirar(id);
            // Só mostra o resultado da pergunta em que EU palpitei: escancarar a
            // resposta de uma que o fã nem viu é ruído, não jogo.
            if (escolhas.current.has(id)) {
              setResultados((rs) => [
                {
                  questionId: id,
                  prompt: enunciados.current.get(id) ?? '',
                  correctOptionId: msg.correctOptionId as string | undefined,
                  voidReason: msg.reason as string | undefined,
                  gained: (msg.gained as number) ?? 0,
                  minhaEscolha: escolhas.current.get(id) ?? null,
                },
                ...rs,
              ]);
            }
            return;
          }

          case 'ranking': {
            // O servidor já ordenou e já marcou quem sou eu. A tela não soma XP
            // nem reordena: quem conta o ranking é quem pagou o XP.
            setRanking(msg.rows as SalaRankRow[]);
            return;
          }

          case 'game_end':
          case 'replay_done': {
            setState((p) => (p ? { ...p, finished: true } : p));
            setDesafios([]);
            return;
          }
        }
      };

      es.onerror = () => {
        // O EventSource reconecta sozinho. Só reclama se nunca chegou estado.
        if (vivo) setState((p) => (p ? p : (setErro('a conexão com a sala caiu'), p)));
      };
    })();

    return () => {
      vivo = false;
      es?.close();
    };
  }, [fixtureId, ativo]);

  /**
   * Manda o palpite. O veredito é do servidor — aqui não se decide nada.
   * O que muda na hora é só o RECIBO: sem isso o fã toca e a tela não reage.
   */
  const palpitar = useCallback(
    async (questionId: string, optionId: string): Promise<{ ok: boolean; error?: string }> => {
      const { api } = await import('@/lib/api');
      try {
        await api.predict(fixtureId, { questionId, optionId });
        escolhas.current.set(questionId, optionId);
        setDesafios((ds) =>
          ds.map((d) => (d.questionId === questionId ? { ...d, minhaEscolha: optionId } : d)),
        );
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'não deu para palpitar' };
      }
    },
    [fixtureId],
  );

  return { state, desafios, resultados, ranking, erro, palpitar };
}
