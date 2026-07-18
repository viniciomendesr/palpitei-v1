/**
 * O canal ao vivo — o chamador que o `startLiveIngest` nunca teve (CONTEXT §10).
 *
 * Vive no processo (globalThis, como db.ts/lobbies.ts, para sobreviver ao HMR):
 * uma réplica Railway, um ingest, um barramento. Responsabilidades por evento,
 * NESTA ordem:
 *
 *   1. filtrar por fixture (o stream entrega a devnet inteira) — descarte CONTADO;
 *   2. PERSISTIR (A1: o dataset rotaciona; gravar só no fim é apostar tudo num
 *      processo que não pode reiniciar) — assíncrono, falha contada e logada alto;
 *   3. rotear para a sala live via barramento — só o que passa no filtro de
 *      mercado (live-regras.ts); `foraDoMercado` sobe em vez de sumir.
 *
 * "open / 0 eventos" NÃO é sucesso (A7): só `normalizados > 0` prova que o
 * caminho vive. O status daqui + /api/live/status são os olhos do runbook —
 * no dia do jogo ninguém anexa debugger.
 */

import { gradePregame, type NormEvent } from '@palpitei/core';
import {
  fetchFixtures,
  info,
  liveResumo,
  liveStatus,
  segundosEmSilencio,
  startLiveIngest,
  warn,
  type LiveStatus,
} from '@palpitei/txline';
import { createEventRepo, createMatchRepo, createOddsRepo, createPregamePickRepo } from '@palpitei/db';
import { createDb } from './db';
import { enfileirarPersistenciaAntesDePublicar } from './eventPipeline';
import { classificarParaSala, eventoEncerraPartida, fixturesAoVivo } from './live-regras';

type Contadores = {
  ignoradosDeOutrasFixtures: number;
  foraDoMercado: number;
  roteadosParaSala: number;
  persistidosScores: number;
  persistidosOdds: number;
  falhasDePersistencia: number;
  /** Eventos que não chegaram à sala porque sua gravação falhou. */
  publicacoesSuprimidasPorPersistencia: number;
  errosDeHandler: number;
};

type Canal = {
  fixtureId: number;
  iniciadoEm: number;
  semeada: boolean;
  marcadaAoVivo: boolean;
  contadores: Contadores;
  handlers: Set<(ev: NormEvent) => void>;
  /** Fila serializada de escrita: ordena os upserts e limita a concorrência a 1. */
  fila: Promise<void>;
  /**
   * As funções de status DO BUNDLE que ligou o ingest. O Next empacota
   * instrumentation.ts e as rotas separadamente, e o txline (transpilado como
   * fonte) vira DUAS instâncias de módulo — o `liveStatus` importado pela rota
   * não é o do bundle onde os streams vivem (medido no dry-run de 17/07: log
   * dizia "ABERTO", a rota dizia "off"). O canal mora em globalThis, então
   * capturar as funções aqui aponta sempre para a instância certa.
   */
  txline: {
    resumo: typeof liveResumo;
    status: () => { scores: LiveStatus; odds: LiveStatus };
    silencio: typeof segundosEmSilencio;
  };
};

const CHAVE = '__palpitei_canais_ao_vivo__' as const;
type GlobalComCanais = typeof globalThis & { [CHAVE]?: Map<number, Canal> };

const canaisAtivos = (): Map<number, Canal> | null => (globalThis as GlobalComCanais)[CHAVE] ?? null;

/** A primeira fixture ativa, preservada para consumidores legados do status. */
export function fixtureDoCanal(): number | null {
  return canaisAtivos()?.keys().next().value ?? null;
}

/** Todas as fixtures ativas: uma conexão SSE pode servir mais de uma partida. */
export function fixturesDosCanais(): number[] {
  return [...(canaisAtivos()?.keys() ?? [])];
}

/** Decide se uma sala deve usar o alimentador ao vivo. */
export function fixtureTemCanalAoVivo(fixtureId: number): boolean {
  return canaisAtivos()?.has(fixtureId) ?? false;
}

/**
 * A sala live registra aqui o MESMO `processarEvento` que o ReplayRunner usa.
 * Devolve o unsubscribe; null quando o canal não está ligado (flags fechadas).
 */
export function assinarCanalAoVivo(
  fixtureId: number,
  handler: (ev: NormEvent) => void,
): (() => void) | null {
  const canal = canaisAtivos()?.get(fixtureId);
  if (!canal) return null;
  canal.handlers.add(handler);
  return () => canal.handlers.delete(handler);
}

/**
 * Semeia a linha da fixture no `matches` — sem ela a sala dá 404 e, sem
 * `start_ts`, a âncora do relógio do ramo live não existe. Insiste com backoff:
 * sem a linha não há sala live, então falhar de vez não é opção silenciosa.
 */
async function semear(canal: Canal, tentativa = 0): Promise<void> {
  try {
    const fixtures = await fetchFixtures();
    const fx = fixtures.find((f) => f.fixtureId === canal.fixtureId);
    if (!fx) throw new Error(`fixture ${canal.fixtureId} não está no snapshot da devnet`);
    await createMatchRepo(createDb()).upsert(fx, { source: 'txline-live' });
    canal.semeada = true;
    info(`[canal-ao-vivo] fixture ${canal.fixtureId} semeada no banco (source txline-live)`);
  } catch (e) {
    const espera = Math.min(5_000 * 2 ** tentativa, 60_000);
    warn(
      `[canal-ao-vivo] SEMEADURA FALHOU (tentativa ${tentativa + 1}): ${
        e instanceof Error ? e.message : String(e)
      } — sem esta linha NÃO HÁ SALA LIVE; nova tentativa em ${espera}ms`,
    );
    setTimeout(() => void semear(canal, tentativa + 1), espera);
  }
}

function registrarFalhaDePersistencia(canal: Canal, oQue: string, erro: unknown): void {
  canal.contadores.falhasDePersistencia += 1;
  canal.contadores.publicacoesSuprimidasPorPersistencia += 1;
  const tipo = erro instanceof Error ? erro.name : typeof erro;
  warn(
    `[canal-ao-vivo] FALHA DE PERSISTÊNCIA (${oQue}, #${canal.contadores.falhasDePersistencia}); ` +
      `evento NÃO publicado na sala (tipo=${tipo})`,
  );
}

function publicarParaSala(canal: Canal, ev: NormEvent): void {
  const classe = classificarParaSala(ev, canal.fixtureId);
  if (classe === 'fora_do_mercado') {
    canal.contadores.foraDoMercado += 1;
    return;
  }

  canal.contadores.roteadosParaSala += 1;
  for (const handler of canal.handlers) {
    try {
      handler(ev);
    } catch (e) {
      canal.contadores.errosDeHandler += 1;
      warn(
        `[canal-ao-vivo] handler da sala falhou (#${canal.contadores.errosDeHandler}): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }
}

function aoReceber(canal: Canal, ev: NormEvent): void {
  if (ev.fixtureId !== canal.fixtureId) {
    canal.contadores.ignoradosDeOutrasFixtures += 1;
    return;
  }

  // Persistência ANTES do roteamento: a sala pode nem existir ainda, e o dado
  // gravado é o que sobrevive a restart (A1). O callback SSE só ENFILEIRA: a
  // publicação ocorre na mesma fila, após a escrita (e o settlement terminal)
  // terminar. Odds grava TODO mercado da fixture — o upsertManyRaw filtra com
  // eh1x2JogoInteiro, o mesmo critério da projeção que o replay lê.
  if (ev.kind === 'score') {
    enfileirarPersistenciaAntesDePublicar(
      canal,
      async () => {
        const db = createDb();

        // Só score marca a partida como ao vivo. Esta decisão acontece DENTRO
        // da fila: se o banco falhar, o próximo score tenta de novo em vez de o
        // flag local afirmar uma transição que não foi gravada.
        if (!canal.marcadaAoVivo) {
          info(`[canal-ao-vivo] PRIMEIRO score da fixture ${canal.fixtureId} — marcando 'live' no banco`);
          await createMatchRepo(db).setState(canal.fixtureId, 'live');
          canal.marcadaAoVivo = true;
        }

        const events = createEventRepo(db);
        await events.upsert(ev);
        canal.contadores.persistidosScores += 1;

        // A liquidação pré-jogo não depende de uma sala aberta. Como esta
        // operação é aguardada, `game_finalised` só chega ao fã depois que o
        // placar final e o XP idempotente foram processados.
        if (eventoEncerraPartida(ev)) {
          await createMatchRepo(db).setState(canal.fixtureId, 'finished');
          const totais = await events.totaisFinais(canal.fixtureId);
          if (totais) {
            await createPregamePickRepo(db).settleFixture(
              canal.fixtureId,
              {
                goalsP1: totais.goals.p1,
                goalsP2: totais.goals.p2,
                cornersTotal: totais.corners.p1 + totais.corners.p2,
              },
              gradePregame,
            );
          } else {
            warn(`[canal-ao-vivo] fim da fixture ${canal.fixtureId} sem totais persistidos — settlement será tentado na leitura`);
          }
        }
      },
      () => publicarParaSala(canal, ev),
      (erro) => registrarFalhaDePersistencia(canal, `score seq ${ev.seq}`, erro),
    );
  } else {
    enfileirarPersistenciaAntesDePublicar(
      canal,
      async () => {
        await createOddsRepo(createDb()).upsertManyRaw([ev.raw]);
        canal.contadores.persistidosOdds += 1;
      },
      () => publicarParaSala(canal, ev),
      (erro) => registrarFalhaDePersistencia(canal, `odds ${ev.messageId ?? ev.ts}`, erro),
    );
  }
}

/**
 * Liga o canal. Idempotente; um no-op silencioso quando as travas estão
 * fechadas (env ausente = DESLIGADO — a 3ª trava, live-regras.ts). É chamada
 * pelo `instrumentation.ts` no boot e, como plano B, na primeira linha do
 * GET /api/live/status.
 */
export function iniciarCanalAoVivo(): void {
  if (canaisAtivos()) return;
  const fixtureIds = fixturesAoVivo(process.env);
  if (!fixtureIds.length) return;

  const canais = new Map<number, Canal>(fixtureIds.map((fixtureId) => [fixtureId, {
    fixtureId,
    iniciadoEm: Date.now(),
    semeada: false,
    marcadaAoVivo: false,
    contadores: {
      ignoradosDeOutrasFixtures: 0,
      foraDoMercado: 0,
      roteadosParaSala: 0,
      persistidosScores: 0,
      persistidosOdds: 0,
      falhasDePersistencia: 0,
      publicacoesSuprimidasPorPersistencia: 0,
      errosDeHandler: 0,
    },
    handlers: new Set(),
    fila: Promise.resolve(),
    txline: {
      resumo: liveResumo,
      status: () => ({ scores: liveStatus.scores, odds: liveStatus.odds }),
      silencio: segundosEmSilencio,
    },
  }]));
  (globalThis as GlobalComCanais)[CHAVE] = canais;

  info(`[canal-ao-vivo] ligando fixtures ${fixtureIds.join(', ')} (TXLINE_LIVE_INGEST=true)`);
  for (const canal of canais.values()) void semear(canal);
  startLiveIngest((ev) => {
    const canal = canais.get(ev.fixtureId);
    if (canal) aoReceber(canal, ev);
  });
}

/** O LiveStatus SEM a amostra crua: payload da TxLINE não sai por rota pública (§7). */
function semAmostra(s: LiveStatus): Omit<LiveStatus, 'ultimaAmostra'> {
  const { ultimaAmostra: _descartada, ...resto } = s;
  return resto;
}

/** O painel do runbook — tudo que os olhos precisam, nada que o §7 proíbe. */
export function statusDoCanal(): Record<string, unknown> {
  const canais = canaisAtivos();
  const canal = canais?.values().next().value as Canal | undefined;
  // Canal ligado: ler pelo bundle que LIGOU (canal.txline) — o import local
  // deste arquivo pode ser a outra instância do módulo, com contadores zerados.
  const resumo = canal ? canal.txline.resumo() : liveResumo();
  const streams = canal ? canal.txline.status() : { scores: liveStatus.scores, odds: liveStatus.odds };
  const silencio = canal ? canal.txline.silencio : segundosEmSilencio;
  return {
    ativo: canais !== null,
    fixtureId: canal?.fixtureId ?? null,
    iniciadoEm: canal?.iniciadoEm ?? null,
    fixtureSemeada: canal?.semeada ?? false,
    marcadaAoVivo: canal?.marcadaAoVivo ?? false,
    resumo,
    streams: { scores: semAmostra(streams.scores), odds: semAmostra(streams.odds) },
    silencioSegundos: { scores: silencio('scores'), odds: silencio('odds') },
    contadores: canal?.contadores ?? null,
    fixtures: [...(canais?.values() ?? [])].map((c) => ({
      fixtureId: c.fixtureId,
      iniciadoEm: c.iniciadoEm,
      fixtureSemeada: c.semeada,
      marcadaAoVivo: c.marcadaAoVivo,
      contadores: c.contadores,
    })),
  };
}
