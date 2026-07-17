'use client';

/**
 * A sala real, por SSE. O oposto da sala do mock — e a inversão é o ponto.
 *
 * No mock o motor mora DENTRO do componente: `const correct = optId ===
 * spec.correct`. Aqui quem decide é o SERVIDOR, sempre: ele abre a pergunta,
 * fecha a janela pelo relógio do FEED e diz quem acertou. Este hook só escuta e
 * mostra. Cliente que decide o próprio XP é fraude de um curl (CONTEXT §4).
 *
 * Por isso não há aqui nenhum `setInterval` resolvendo desafio. O único relógio
 * local é o do cronômetro na tela, e ele é COSMÉTICO: nasce do `closesInRealMs`
 * que o servidor manda (o Clock já converteu tempo de jogo → tempo real). Se ele
 * e o servidor divergirem, quem vale é o servidor — a tela não fecha janela.
 *
 * Os eventos são os do §8, já traduzidos pela sala para a primeira pessoa:
 * `question_resolved` traz `gained` (o MEU xp), não o `results[]` de todo mundo.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type SalaOpcao = { id: string; label: string; pct: number | null };

export type SalaDesafio = {
  questionId: string;
  prompt: string;
  options: SalaOpcao[];
  xp: number;
  /** Prazo em ms REAIS, convertido pelo Clock do servidor. Só para o cronômetro. */
  closesInRealMs: number;
};

export type SalaLance = {
  minute: number | null;
  action: string;
  goals: { p1: number; p2: number } | null;
};

export type SalaState = {
  fixtureId: number;
  teamA: string;
  teamB: string;
  source: string;
  score: { p1: number; p2: number };
  minute: number | null;
  finished: boolean;
  feed: SalaLance[];
};

export type SalaResultado = {
  questionId: string;
  /** undefined quando a pergunta foi ANULADA. */
  correctOptionId?: string;
  /** Motivo da anulação: o lance resolvedor chegou com a janela aberta. Sem XP, e é justo. */
  voidReason?: string;
  /** O XP que EU ganhei. O servidor é quem soma — a tela nunca. */
  gained: number;
  /** A opção que eu escolhi, para a tela poder dizer "você cravou"/"não era essa". */
  minhaEscolha: string | null;
};

export function useSala(fixtureId: string, ativo: boolean) {
  const [state, setState] = useState<SalaState | null>(null);
  const [desafio, setDesafio] = useState<SalaDesafio | null>(null);
  const [resultado, setResultado] = useState<SalaResultado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  /** O que EU respondi, por pergunta. O servidor recusa a segunda tentativa. */
  const minhas = useRef<Map<string, string>>(new Map());

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

      es.onmessage = (e) => {
        if (!vivo) return;
        const msg = JSON.parse(e.data) as Record<string, unknown> & { type: string };

        switch (msg.type) {
          case 'room_state': {
            setState(msg.state as SalaState);
            return;
          }

          case 'score_event': {
            const scoreA = msg.scoreA as number | null;
            const scoreB = msg.scoreB as number | null;
            setState((p) =>
              p
                ? {
                    ...p,
                    // AUSENTE ≠ ZERO (A4). O servidor manda null quando o lance
                    // não mexeu no placar; `?? 0` aqui daria gol fantasma ao
                    // contrário — o placar REGREDIRIA a 0–0 no meio do jogo.
                    score: {
                      p1: scoreA ?? p.score.p1,
                      p2: scoreB ?? p.score.p2,
                    },
                    minute: (msg.minute as number | null) ?? p.minute,
                    feed: [msg.lance as SalaLance, ...p.feed].slice(0, 40),
                  }
                : p,
            );
            return;
          }

          case 'question_open': {
            setResultado(null);
            setDesafio({
              questionId: msg.questionId as string,
              prompt: msg.prompt as string,
              options: msg.options as SalaOpcao[],
              xp: (msg.xp as number) ?? 0,
              closesInRealMs: (msg.closesInRealMs as number) ?? 0,
            });
            return;
          }

          case 'question_closed': {
            const id = msg.questionId as string;
            setDesafio((d) => (d?.questionId === id ? null : d));
            return;
          }

          case 'question_resolved':
          case 'question_void': {
            const id = msg.questionId as string;
            setDesafio((d) => (d?.questionId === id ? null : d));
            // Só revela o resultado da pergunta em que EU palpitei: escancarar a
            // resposta de uma pergunta que o fã nem viu é ruído, não jogo.
            if (minhas.current.has(id)) {
              setResultado({
                questionId: id,
                correctOptionId: msg.correctOptionId as string | undefined,
                voidReason: msg.reason as string | undefined,
                gained: (msg.gained as number) ?? 0,
                minhaEscolha: minhas.current.get(id) ?? null,
              });
            }
            return;
          }

          case 'game_end':
          case 'replay_done': {
            setState((p) => (p ? { ...p, finished: true } : p));
            return;
          }
        }
      };

      es.onerror = () => {
        // O EventSource reconecta sozinho; só avisa se ainda não temos estado.
        if (vivo) setState((p) => (p ? p : (setErro('a conexão com a sala caiu'), p)));
      };
    })();

    return () => {
      vivo = false;
      es?.close();
    };
  }, [fixtureId, ativo]);

  /** Manda o palpite. O veredito é do servidor — aqui não se decide nada. */
  const palpitar = useCallback(
    async (questionId: string, optionId: string): Promise<{ ok: boolean; error?: string }> => {
      const { api } = await import('@/lib/api');
      try {
        await api.predict(fixtureId, { questionId, optionId });
        minhas.current.set(questionId, optionId);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'não deu para palpitar' };
      }
    },
    [fixtureId],
  );

  return { state, desafio, resultado, erro, palpitar };
}
