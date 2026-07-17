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
import { esperaDeReconexao } from '@/lib/reconexao';
import { segundoDoReplay } from '@/lib/relogio';

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
  /** Âncora do relógio (segundos de jogo do último evento com relógio). */
  clockSeconds?: number | null;
  /** Minutos de jogo por segundo real — 12 no replay padrão, 1 ao vivo. */
  replaySpeed?: number;
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

export function useSala(fixtureId: string, ativo: boolean, onGanho?: (xp: number) => void) {
  const [state, setState] = useState<SalaState | null>(null);
  const [desafios, setDesafios] = useState<SalaDesafio[]>([]);
  const [resultados, setResultados] = useState<SalaResultado[]>([]);
  const [ranking, setRanking] = useState<SalaRankRow[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  /**
   * MEUS palpites aqui valem XP? `treino: true` = não — ou porque a sala é de
   * treino (`treinoDaSala`), ou porque EU já joguei esta partida antes e a
   * sala valendo só paga a primeira jogada. A tela avisa; o servidor decide.
   */
  const [treino, setTreino] = useState(false);
  const [treinoDaSala, setTreinoDaSala] = useState(false);
  /**
   * O relógio INTERPOLADO entre eventos, em segundos DE JOGO. O feed pode
   * ficar minutos sem lance; sem isto o badge congelava no 0’ e saltava para
   * o 6’ — relógio parado com cara de sala travada. A âncora é sempre o
   * último evento COM relógio (B2): o lance re-ancora, a parede só preenche.
   */
  const [segundosVivos, setSegundosVivos] = useState<number | null>(null);
  const ancora = useRef<{ game: number; realAt: number } | null>(null);
  const speedRef = useRef<number | null>(null);
  const acabouRef = useRef(false);
  /** O enunciado de cada pergunta, para o resultado poder dizer do que se tratava. */
  const enunciados = useRef<Map<string, string>>(new Map());
  const escolhas = useRef<Map<string, string>>(new Map());
  /**
   * Por ref: o callback muda a cada render de quem chama, e no array de deps
   * ele derrubaria e reabriria o SSE a cada tecla. Só dispara em resolução AO
   * VIVO — o histórico semeado do room_state não passa por aqui, senão cada F5
   * somaria o mesmo XP de novo.
   */
  const onGanhoRef = useRef(onGanho);
  onGanhoRef.current = onGanho;

  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    let es: EventSource | null = null;
    /** O timer da PRÓXIMA tentativa — no máximo um; dois abririam duas conexões. */
    let proxima: ReturnType<typeof setTimeout> | null = null;
    let tentativa = 0;
    /** Já chegou room_state? Decide se queda vira tela de erro ou reconexão muda. */
    let temEstado = false;
    /** Trava contra conectar() em paralelo (queda e volta do background juntas). */
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

    /**
     * Reconexão MANUAL, nunca a automática do EventSource — por causa do token.
     * O Bearer vai na URL (EventSource não manda header) e o auto-reconnect
     * reusa a MESMA URL: com o token da Privy vencido (~1h), a primeira queda
     * depois disso reconecta num 401 — e status ≠ 200 encerra o EventSource DE
     * VEZ, sem nova tentativa. Com estado na tela, o onerror antigo não dizia
     * nada: a sala congelava em silêncio, placar parado com cara de saudável.
     * Aqui toda conexão nasce com token FRESCO de getAuthToken() (a Privy
     * renova por baixo) e a queda agenda outra tentativa, com backoff.
     */
    const conectar = async () => {
      if (!vivo || conectando) return;
      conectando = true;
      es?.close();
      es = null;
      // Rejeição (a ilha reidratando na volta do background) vira null — e
      // null reagenda, não desiste.
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
        `/api/rooms/${encodeURIComponent(fixtureId)}/stream?token=${encodeURIComponent(token)}`,
      );

      es.onopen = () => {
        // Conexão de pé: a próxima queda recomeça o backoff do zero.
        tentativa = 0;
      };

      const tirar = (id: string) => setDesafios((ds) => ds.filter((d) => d.questionId !== id));

      es.onmessage = (e) => {
        if (!vivo) return;
        const msg = JSON.parse(e.data) as Record<string, unknown> & { type: string };

        switch (msg.type) {
          case 'room_state': {
            // Chegou estado: daqui em diante uma queda não vira tela de erro,
            // vira reconexão calada — e é ESTE pacote que ressemeia a volta.
            // Tudo abaixo SUBSTITUI (setState/setDesafios/setResultados montam
            // listas novas; os Maps são set por id): reconectar não duplica.
            temEstado = true;
            setErro(null);
            const s = msg.state as SalaState & { questions?: QuestionDoServidor[] };
            setTreino(Boolean(msg.treino));
            setTreinoDaSala(Boolean(msg.treinoDaSala));
            // A âncora do relógio, do estado inteiro: quem entra no minuto 34
            // vê o 34 andando, não parado.
            if (typeof s.clockSeconds === 'number') {
              ancora.current = { game: s.clockSeconds, realAt: Date.now() };
            }
            if (typeof s.replaySpeed === 'number') speedRef.current = s.replaySpeed;
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
              // Quem chega no meio do jogo já pega os totais acumulados da sala.
              totals: s.totals ?? { p1: {}, p2: {} },
            });

            // O que EU já respondi, na memória do SERVIDOR — semeia os recibos
            // ANTES de montar a lista. Um F5 derruba a tela, não o palpite: sem
            // isto o fã via a pergunta aberta de novo, tocava, e ouvia "você já
            // palpitou" — o recibo morria com o reload e o motor sempre soube.
            const minhas = (msg.minhas ?? []) as { questionId: string; choice: string }[];
            for (const m of minhas) escolhas.current.set(m.questionId, m.choice);

            // Quem chega no meio do jogo pega TODAS as janelas já abertas — e as
            // FECHADAS em que ele palpitou (o card "janela fechada" renasce).
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
                    // O piso do motor, vindo no pacote — 0 só se o servidor não mandou.
                    xp: q.xp ?? 0,
                    // O prazo REAL da janela, pelo relógio da sala. O fallback de
                    // 60s só sobrevive para servidor antigo sem o campo.
                    fechaEm: agora + (q.closesInRealMs ?? 60_000),
                    minhaEscolha: escolhas.current.get(q.id) ?? null,
                    fechado: q.state === 'closed',
                  };
                }),
            );

            // O histórico dos MEUS palpites, como o servidor os liquidou — já
            // na ordem da tela (mais recente primeiro). O reload não apaga o
            // que o jogo já pagou.
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
            // O lance re-ancora o relógio. null = este evento veio sem relógio;
            // a âncora anterior continua valendo (ausente ≠ zero).
            if (typeof msg.clockSeconds === 'number') {
              ancora.current = { game: msg.clockSeconds as number, realAt: Date.now() };
            }
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
              // O XP que o MOTOR pagou agora — o contador da tela acompanha.
              // A verdade continua no banco; o próximo /api/state reconfirma.
              if (gained > 0) onGanhoRef.current?.(gained);
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
            acabouRef.current = true;
            setState((p) => (p ? { ...p, finished: true } : p));
            setDesafios([]);
            return;
          }
        }
      };

      es.onerror = () => {
        // Fecha e recria com token FRESCO em vez de confiar no auto-reconnect
        // (o porquê está no comentário do conectar). Erro de tela só se NUNCA
        // chegou estado; com a sala desenhada, a reconexão é calada — e o
        // room_state do reencontro ressemeia tudo (substitui, não duplica).
        es?.close();
        es = null;
        if (!vivo) return;
        if (!temEstado) setErro('a conexão com a sala caiu');
        agendar();
      };
    };

    /**
     * A volta do background. Safari/Chrome mobile matam o EventSource da aba
     * de fundo, e o timer de reconexão dorme junto com ela: sem isto o fã
     * voltava para uma sala parada — dados velhos, ou conexão morta — até o
     * timer acordar, se acordasse. Se a conexão não está viva, reconecta JÁ,
     * com token fresco e backoff zerado.
     */
    const aoVoltar = () => {
      if (!vivo || conectando || document.visibilityState !== 'visible') return;
      // CONNECTING e OPEN seguem seu curso; só CLOSED (ou nenhum) precisa de ajuda.
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
  }, [fixtureId, ativo]);

  // O tique do relógio da tela: 250ms de intervalo (a 12×, 1s real = 12s de
  // jogo — com 1s de tique o cronômetro pularia de 12 em 12), re-renderizando
  // só quando o SEGUNDO exibido muda. Congela no apito final — relógio que
  // anda depois do fim é mentira andando.
  useEffect(() => {
    if (!ativo) return;
    const tick = () => {
      if (acabouRef.current || !ancora.current || speedRef.current === null) return;
      const s = segundoDoReplay(
        ancora.current.game,
        ancora.current.realAt,
        speedRef.current,
        Date.now(),
      );
      setSegundosVivos((antes) => (antes === s ? antes : s));
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [ativo, fixtureId]);

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

  return {
    state,
    desafios,
    resultados,
    ranking,
    erro,
    treino,
    treinoDaSala,
    segundosVivos,
    palpitar,
  };
}
