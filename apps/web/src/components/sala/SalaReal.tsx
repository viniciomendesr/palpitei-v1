'use client';

/**
 * A sala da partida REAL — a mesma casca da sala do mock, outro motor.
 *
 * Vive separada de propósito. A sala do mock resolve o desafio DENTRO do
 * componente (`const correct = optId === spec.correct`) e roda um setInterval
 * como relógio; aqui quem abre, fecha e julga é o servidor, e a tela só desenha
 * o que chega pelo SSE. São duas máquinas de estado opostas — enfiar as duas no
 * mesmo componente com `if (demo)` seria o jeito mais rápido de quebrar o
 * caminho do jurado, que é o único que não pode falhar (§5.1).
 *
 * O que a tela NÃO faz, e é o ponto: não decide acerto, não credita XP, não
 * fecha janela. Se o cronômetro daqui zerar antes do servidor, o palpite ainda
 * vale; se o servidor fechar antes, o POST volta 409 e o fã ouve a verdade.
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SegTabs, Badge, Button } from '@/components/ds';
import { Screen } from '@/components/Shell';
import { ChevronLeft, Star } from '@/components/Icons';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { fw } from '@/lib/tokens';
import {
  useSala,
  type SalaDesafio,
  type SalaLance,
  type SalaResultado,
  type SalaTotais,
} from '@/lib/useSala';
import { usePrivyAuth } from '@/components/privy/PrivyIsland';

type SalaTab = 'desafios' | 'lances' | 'stats' | 'ranking';

/** O nome do lance na voz do fã. Gíria de futebol, nunca jargão de aposta. */
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

/**
 * A pergunta redigida AQUI, por tipo — não o prompt cru do servidor. O motor
 * grava pt fixo; a tela é bilíngue e o fã de EN lê no idioma dele. Tipo
 * desconhecido cai no prompt do servidor: texto verdadeiro vale mais que
 * texto bonito.
 */
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

/** O rótulo de uma opção: p1/p2 são os TIMES; o resto sai do dicionário. */
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

/**
 * A explicação do resultado: FATOS do feed no instante da liquidação, que o
 * servidor capturou (minuto, placar, escanteios). Sem fatos, sem frase — uma
 * explicação inventada seria o G6 dentro da tela de resultado.
 */
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

type LinhaDeStat = { chave: string; label: string; a: number; b: number; aFlex: number; bFlex: number };

/**
 * Uma linha por chave que o feed DESTA partida trouxe — nunca uma lista fixa.
 * Medido no England × Argentina: o Total é `{ Goals, Corners, YellowCards }` e
 * mais nada. Uma linha de "Posse de bola" com 0% aqui seria número inventado
 * sobre partida real, que é o G6 — o motivo de o projeto existir.
 *
 * A ORDEM sai do próprio dicionário: o mapa de rótulos já está na ordem em que o
 * fã espera ler (gol antes de cartão), e as chaves acumuladas chegam na ordem em
 * que o feed as revelou (`Corners` antes de `Goals`, porque o 1º gol só saiu no
 * seq 539). Chave sem rótulo vai para o fim, em ordem alfabética, e aparece CRUA.
 */
function linhasDeStats(totals: SalaTotais, rotulos: Record<string, string>): LinhaDeStat[] {
  const ordem = Object.keys(rotulos);
  const posicao = (k: string) => {
    const i = ordem.indexOf(k);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };

  return [...new Set([...Object.keys(totals.p1), ...Object.keys(totals.p2)])]
    .sort((a, b) => posicao(a) - posicao(b) || a.localeCompare(b))
    .map((chave) => {
      // Aqui, DENTRO do Total, ausente = zero (G7) — o oposto do bloco Score
      // ausente (A4). Um lado pode contar e o outro não ter chegado a contar.
      const a = totals.p1[chave] ?? 0;
      const b = totals.p2[chave] ?? 0;
      return {
        chave,
        // Sem rótulo, o nome cru. Esconder a chave desconhecida seria a
        // estatística sumindo da tela sem ninguém ver — exatamente o G7.
        label: rotulos[chave] ?? chave,
        a,
        b,
        // Piso de 0.4: com flex 0 a barra some e o zero fica invisível.
        aFlex: Math.max(a, 0.4),
        bFlex: Math.max(b, 0.4),
      };
    });
}

/** As iniciais do time. Bandeira de verdade só existe para Argentina e Cabo
 *  Verde no ds — e inventar uma bandeira errada é pior que não ter. */
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

/** Segundos que faltam, do prazo real que o servidor mandou. Cosmético: quem
 *  fecha a janela é o servidor, nunca este contador. */
function useSegundos(fechaEm: number | null): number {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (fechaEm == null) return;
    const tick = () => setSecs(Math.max(0, Math.ceil((fechaEm - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [fechaEm]);
  return secs;
}

/** Um desafio: aberto para responder, ou o recibo do que eu já mandei. */
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
  /** Sem pagamento (sala de treino / já jogou): o card não promete XP nenhum. */
  treino: boolean;
  teamA: string;
  teamB: string;
}) {
  const { t } = useI18n();
  const secs = useSegundos(d.fechaEm);
  // O rótulo sai do TIPO que o motor deu à pergunta. Sem correspondência, cai no
  // genérico — nunca inventa um nome bonito para um tipo que não conheço.
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
          {/* "+0 XP" seria promessa quebrada com cara de prêmio: no treino a
              etiqueta diz TREINO, e valor só aparece quando há valor. */}
          {rotulo[d.type] ?? t.salaChallenge} · {treino ? t.treinoTag : `+${d.xp} XP`}
        </span>
        {/* Janela fechada não tem contagem regressiva: o que falta agora é o
            LANCE, não o tempo. Um "0s" parado ali diria que o fã perdeu o prazo. */}
        <span style={{ fontSize: 12, fontWeight: fw.black, color: d.fechado ? 'var(--text-muted)' : secs <= 3 ? 'var(--red)' : 'var(--text-2)' }}>
          {d.fechado ? t.salaClosedWindow : `${secs}s`}
        </span>
      </div>

      <p style={{ fontSize: 16, fontWeight: fw.heavy, marginTop: 8, textWrap: 'pretty' }}>
        {textoDaPergunta(d.type, d.prompt, t, teamA, teamB)}
      </p>

      {/* O RECIBO. Sem isto o fã toca e a tela não reage: o servidor só volta a
          falar quando o LANCE resolve, e isso leva minutos de jogo. O recibo não
          é o motor — é o que eu mandei; quem julga continua sendo o servidor. */}
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
              {rotuloDaOpcao(o.id, t, teamA, teamB, d.options)}
              {/* `pct` vem do explicador de odds, que esta sala ainda não roda.
                  null = a TxLINE não mandou preço (G8), e AUSENTE não é 0%:
                  mostrar "0%" aqui seria a explicação fantasma do v0. */}
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

export function SalaReal({ fixtureId }: { fixtureId: string }) {
  const router = useRouter();
  const { t, fmt } = useI18n();
  const { session, addXp } = useSession();
  const privy = usePrivyAuth();
  // Espera a ilha ficar pronta ANTES de abrir o stream. O React roda efeitos de
  // baixo pra cima: no primeiro mount, o efeito desta tela corre antes de o
  // PrivyIsland (mãe) registrar o authTokenProvider — o token sai null, o SSE vai
  // sem Bearer e o fã LOGADO lê "sem sessão verificada". É a mesma corrida que
  // derrubou a home; a lição é a mesma.
  //
  // `addXp` no terceiro argumento: quando o motor paga, o contador do cabeçalho
  // acompanha na hora — antes ele mostrava o XP de quando a sessão nasceu, e o
  // fã via "+75" no resultado com o total parado.
  const { state, desafios, resultados, ranking, erro, treino, treinoDaSala, minutoVivo, palpitar } =
    useSala(fixtureId, privy.ready && privy.authenticated, addXp);

  const [tab, setTab] = useState<SalaTab>('desafios');
  const [enviando, setEnviando] = useState<string | null>(null);
  const [recusa, setRecusa] = useState<Record<string, string>>({});

  // A aba NÃO rouba mais o foco quando abre desafio. Quem chama o fã é o
  // OVERLAY: a janela dura ~96s de tempo real e ele não pode ter que procurar
  // uma aba. Trocar a aba embaixo dele ainda por cima tirava o feed da tela no
  // meio do lance que o desafio pergunta.

  // Antes do early return: hook não pode rodar condicionalmente. Lista vazia
  // enquanto não há estado — a aba só desenha depois da guarda abaixo.
  const stats = useMemo(
    () => (state ? linhasDeStats(state.totals, t.statKeys) : []),
    [state?.totals, t.statKeys],
  );

  const responder = async (questionId: string, optionId: string) => {
    if (enviando) return;
    setEnviando(questionId);
    const r = await palpitar(questionId, optionId);
    setEnviando(null);
    // "janela fechada", "você já palpitou": é o servidor falando. Mostra.
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

  const selo = state.source === 'txline-live' ? t.srcTxline : t.srcReplay;
  const abertos = desafios.filter((d) => d.minhaEscolha === null && !d.fechado).length;
  /**
   * O overlay mostra UM: o mais recente ainda sem resposta.
   *
   * O motor abre janelas sobrepostas (próximo gol + escanteio), e empilhar todas
   * por cima do jogo taparia justamente o lance que elas perguntam. O resto vive
   * na aba Desafios, com o contador no rótulo — some da frente, não da vista.
   */
  const noOverlay = desafios.filter((d) => d.minhaEscolha === null && !d.fechado).at(-1) ?? null;

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
            onClick={() => router.push('/home')}
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
          {/* Uma partida GRAVADA não é "ao vivo", por mais que o relógio corra.
              O minuto é o INTERPOLADO: entre um lance e outro ele continua
              andando — o do servidor é o piso, nunca o teto. */}
          <Badge tone={state.finished ? 'neutral' : 'live'} dot={!state.finished}>
            {state.finished
              ? t.lanceEnd
              : `${t.replayShort} · ${Math.max(minutoVivo ?? 0, state.minute ?? 0)}’`}
          </Badge>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: fw.heavy, color: 'var(--gold)' }}>
            <Star />
            {fmt(session.xp)} XP
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, padding: '0 6px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 96 }}>
            <Escudo nome={state.teamA} />
            <span style={{ fontWeight: fw.heavy, fontSize: 13.5, textAlign: 'center' }}>{state.teamA}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontWeight: fw.black, fontSize: 40, fontStyle: 'italic', letterSpacing: -2, lineHeight: 1 }}>
              {state.score.p1} – {state.score.p2}
            </span>
            <span style={{ fontSize: 10, fontWeight: fw.heavy, letterSpacing: 0.8, color: 'var(--text-muted)', marginTop: 4 }}>
              {selo}
            </span>
            {/* SEM XP tem que estar escrito ANTES do primeiro palpite — sala de
                treino (ou "você já jogou") vestida de sala valendo é o G6. */}
            {treino && (
              <span style={{ fontSize: 10, fontWeight: fw.black, letterSpacing: 0.8, color: 'var(--orange)', marginTop: 3 }}>
                {treinoDaSala ? t.treinoSelo : t.jaJogouSelo}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 96 }}>
            <Escudo nome={state.teamB} />
            <span style={{ fontWeight: fw.heavy, fontSize: 13.5, textAlign: 'center' }}>{state.teamB}</span>
          </div>
        </div>
      </div>

      <div style={{ flex: 'none', padding: '12px 18px 0' }}>
        <SegTabs
          tabs={[
            // O contador diz quantas janelas estão abertas AGORA. O motor abre
            // várias ao mesmo tempo (próximo gol + escanteio), e antes disto só
            // a última aparecia — as outras sumiam com o XP junto.
            { label: abertos ? `${t.salaTabChallenges} (${abertos})` : t.salaTabChallenges, value: 'desafios' },
            { label: t.salaTabPlays, value: 'lances' },
            { label: t.salaTabStats, value: 'stats' },
            { label: t.salaTabRanking, value: 'ranking' },
          ]}
          value={tab}
          onChange={(v) => setTab(v as SalaTab)}
        />
      </div>

      <Screen padding={noOverlay ? '14px 18px 300px' : '14px 18px 24px'}>
        {tab === 'desafios' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* O que está no overlay sai da lista: mostrar o mesmo desafio duas
                vezes na mesma tela é o fã achando que são dois. */}
            {desafios.filter((d) => d.questionId !== noOverlay?.questionId).map((d) => (
              <CardDoDesafio
                key={d.questionId}
                d={d}
                treino={treino}
                teamA={state.teamA}
                teamB={state.teamB}
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

            {/* Os resultados dos MEUS palpites, quando o lance resolve. */}
            {resultados.length > 0 && (
              <>
                <div style={{ fontSize: 10.5, fontWeight: fw.black, letterSpacing: 1, color: 'var(--text-muted)', marginTop: 10 }}>
                  {t.salaResultsHdr}
                </div>
                {resultados.map((r) => {
                  // Acerto é comparar com o GABARITO do servidor — não com o
                  // XP: no treino o acerto paga 0, e `gained > 0` como régua
                  // diria "Errou" para um palpite certo.
                  const acertou =
                    !r.voidReason &&
                    r.correctOptionId !== undefined &&
                    r.minhaEscolha === r.correctOptionId;
                  const minha =
                    r.minhaEscolha !== null
                      ? rotuloDaOpcao(r.minhaEscolha, t, state.teamA, state.teamB, r.options)
                      : null;
                  const certa =
                    r.correctOptionId !== undefined
                      ? rotuloDaOpcao(r.correctOptionId, t, state.teamA, state.teamB, r.options)
                      : null;
                  const explicacao = explicacaoDoResultado(r, t, state.teamA, state.teamB);
                  return (
                    <div
                      key={r.questionId}
                      style={{
                        padding: '12px 14px',
                        borderRadius: 'var(--r-lg)',
                        background: acertou ? 'var(--lime-a06)' : 'var(--surface-1)',
                        border: `1px solid ${acertou ? 'var(--lime-line)' : 'var(--border-1)'}`,
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: fw.medium, color: 'var(--text-2)', textWrap: 'pretty' }}>
                        {r.qtype
                          ? textoDaPergunta(r.qtype, r.prompt, t, state.teamA, state.teamB)
                          : r.prompt}
                      </div>

                      {/* O que EU disse × o que o jogo disse. Sem isto o card
                          julgava sem mostrar as provas. */}
                      {(minha || (certa && !r.voidReason)) && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 8 }}>
                          {minha && (
                            <span style={{ fontSize: 11.5, fontWeight: fw.bold, color: 'var(--text-muted)' }}>
                              {t.youPick}{' '}
                              <span style={{ color: 'var(--text-1)', fontWeight: fw.heavy }}>{minha}</span>
                            </span>
                          )}
                          {certa && !r.voidReason && (
                            <span style={{ fontSize: 11.5, fontWeight: fw.bold, color: 'var(--text-muted)' }}>
                              {t.rightPick}{' '}
                              <span style={{ color: 'var(--lime)', fontWeight: fw.heavy }}>{certa}</span>
                            </span>
                          )}
                        </div>
                      )}

                      {r.voidReason ? (
                        <>
                          <div style={{ fontSize: 13.5, fontWeight: fw.black, marginTop: 6 }}>{t.salaVoid}</div>
                          <div style={{ fontSize: 11.5, fontWeight: fw.medium, color: 'var(--text-muted)', marginTop: 2, textWrap: 'pretty' }}>
                            {t.salaVoidBody}
                          </div>
                        </>
                      ) : (
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: fw.black,
                            marginTop: 8,
                            color: acertou ? 'var(--lime)' : 'var(--text-1)',
                          }}
                        >
                          {acertou
                            ? r.gained > 0
                              ? `${t.salaHit} +${r.gained} XP`
                              : t.salaHitTreino
                            : t.salaMiss}
                        </div>
                      )}

                      {/* A LEITURA DO LANCE: fato do feed no instante em que o
                          desafio liquidou. Sem fatos, sem frase — explicação
                          inventada é o G6 dentro do resultado. */}
                      {explicacao && (
                        <div style={{ fontSize: 11.5, fontWeight: fw.medium, color: 'var(--text-muted)', marginTop: 6, textWrap: 'pretty' }}>
                          {explicacao}
                        </div>
                      )}
                    </div>
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
                  {textoDoLance(l, t, state.teamA, state.teamB)}
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
                <span style={{ fontWeight: fw.heavy, fontSize: 13, color: 'var(--text-1)' }}>{state.teamA}</span>
                {/* "AO VIVO" não: esta sala roda replay, e selo de origem não mente (G6). */}
                <span style={{ fontSize: 10, fontWeight: fw.black, letterSpacing: 1, color: 'var(--text-faint)' }}>
                  {t.statsMatchHdr}
                </span>
                <span style={{ fontWeight: fw.heavy, fontSize: 13, color: 'var(--text-1)' }}>{state.teamB}</span>
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
            /* Nenhum total ainda: a partida não mandou o bloco Score. Uma tabela
               de zeros aqui seria invenção, não espera. */
            <p style={{ textAlign: 'center', padding: 28, fontSize: 13, fontWeight: fw.medium, lineHeight: 'var(--leading-body)', color: 'var(--text-muted)' }}>
              {t.salaStatsWaiting}
            </p>
          ))}
        {tab === 'ranking' && (
          <>
            <div style={{ fontSize: 10, fontWeight: fw.black, letterSpacing: 1, color: 'var(--text-faint)', marginBottom: 10 }}>
              {t.roomRanking}
            </div>
            {/* Sem "N na sala": o servidor manda quem PONTUOU, não quem está
                assistindo. Chamar uma coisa de outra é rótulo mentindo (G6). */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {ranking.map((r, i) => {
                const pos = i + 1;
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
                        // Apelido vazio = o fã não passou pelo passo do apelido.
                        // Dizer "sem apelido" é a leitura honesta; inventar um
                        // nome (ou sacar do e-mail) é o E12 (§4).
                        fontStyle: r.name ? 'normal' : 'italic',
                        color: r.me ? 'var(--lime)' : r.name ? 'var(--text-hi)' : 'var(--text-muted)',
                      }}
                    >
                      {r.me ? t.you : r.name || t.salaNoHandle}
                    </span>
                    <span style={{ fontWeight: fw.heavy, fontSize: 13, color: 'var(--gold)' }}>
                      {fmt(r.xp)} XP
                    </span>
                  </div>
                );
              })}
            </div>
            {!ranking.length && (
              <p style={{ textAlign: 'center', padding: 28, fontSize: 13, fontWeight: fw.medium, lineHeight: 'var(--leading-body)', color: 'var(--text-muted)' }}>
                {t.salaRankEmpty}
              </p>
            )}
          </>
        )}

      </Screen>

      {/* O DESAFIO, POR CIMA DE TUDO.
          A janela dura ~96s reais e fecha sozinha: o fã não pode ter que achar
          uma aba pra palpitar. Fica aqui, sobre qualquer aba, até ele responder
          — e some assim que responde, liberando a tela pro lance que resolve.
          Só o MAIS RECENTE: o motor abre janelas sobrepostas, e empilhar todas
          taparia justamente o jogo que elas perguntam. As outras seguem na aba
          Desafios, contadas no rótulo. */}
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
            teamA={state.teamA}
            teamB={state.teamB}
            enviando={enviando === noOverlay.questionId}
            recusa={recusa[noOverlay.questionId] ?? null}
            onResponder={(o) => responder(noOverlay.questionId, o)}
          />
        </div>
      )}
    </div>
  );
}
