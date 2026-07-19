/**
 * Process-local live channel registry. Events are filtered, persisted, then
 * routed only after the durable write succeeds.
 */

import { gradePregame, type NormEvent } from '@palpitei/core';
import {
  fetchFixtures,
  info,
  liveSummary,
  liveStatus,
  secondsSinceLastEvent,
  startLiveIngest,
  stopLiveIngest,
  warn,
  type LiveStatus,
} from '@palpitei/txline';
import {
  createEventRepo,
  createLiveFixtureRepo,
  createMatchRepo,
  createOddsRepo,
  createPregamePickRepo,
} from '@palpitei/db';
import { createDb } from './db';
import { enfileirarPersistenciaAntesDePublicar } from './eventPipeline';
import { brokerRedisAoVivo } from './live-broker';
import {
  channelsToClose,
  classificarParaSala,
  eventoEncerraPartida,
  fixturesAoVivo,
  ingestAoVivoHabilitado,
  podeAtivarFixtureAoVivo,
} from './live-regras';
import { reconcileOrphanedRooms } from './reconciliation';

type Contadores = {
  ignoradosDeOutrasFixtures: number;
  foraDoMercado: number;
  roteadosParaSala: number;
  persistidosScores: number;
  persistidosOdds: number;
  falhasDePersistencia: number;
  /** Events withheld from rooms because persistence failed. */
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
  /** Serial write queue preserves upsert order and limits concurrency to one. */
  fila: Promise<void>;
  /** Status functions from the bundle that started the ingest. */
  txline: {
    resumo: typeof liveSummary;
    status: () => { scores: LiveStatus; odds: LiveStatus };
    silencio: typeof secondsSinceLastEvent;
  };
};

const CHAVE = '__palpitei_canais_ao_vivo__' as const;
const CHAVE_REFRESH = '__palpitei_canais_ao_vivo_refresh__' as const;
type GlobalComCanais = typeof globalThis & {
  [CHAVE]?: Map<number, Canal>;
  [CHAVE_REFRESH]?: ReturnType<typeof setInterval>;
};

const canaisAtivos = (): Map<number, Canal> | null => (globalThis as GlobalComCanais)[CHAVE] ?? null;

/** First active fixture, kept for legacy status consumers. */
export function fixtureDoCanal(): number | null {
  return canaisAtivos()?.keys().next().value ?? null;
}

/** All active fixtures; one SSE connection can serve multiple matches. */
export function fixturesDosCanais(): number[] {
  return [...(canaisAtivos()?.keys() ?? [])];
}

/** Returns whether a room should use the local live feed. */
export function fixtureTemCanalAoVivo(fixtureId: number): boolean {
  return canaisAtivos()?.has(fixtureId) ?? false;
}

/** Registers a room handler and returns an unsubscribe function when live is enabled. */
export function assinarCanalAoVivo(
  fixtureId: number,
  handler: (ev: NormEvent) => void,
): (() => void) | null {
  const canal = canaisAtivos()?.get(fixtureId);
  if (!canal) return null;
  canal.handlers.add(handler);
  return () => canal.handlers.delete(handler);
}

/** Seeds the match record with exponential retry so live rooms have a clock anchor. */
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

/**
 * Drops one fixture's channel at full time.
 *
 * Only the map entry goes. The TxLINE SSE pair is shared by every fixture, so
 * `stopLiveIngest` here would silence the other match still being played; and the
 * global map must survive so `iniciarCanalAoVivo` stays a no-op and
 * `/api/live/status` keeps reporting the ingest as up.
 */
function closeLocalChannel(fixtureId: number): void {
  const canais = canaisAtivos();
  if (!canais?.delete(fixtureId)) return;
  info(
    `[canal-ao-vivo] fixture ${fixtureId} encerrada — canal local removido ` +
      `(${canais.size} fixture(s) restante(s); streams TxLINE seguem abertos)`,
  );
}

/** The leader persists before publishing; followers only route Redis events. */
function aoReceber(canal: Canal, ev: NormEvent, publicarDistribuido?: (event: NormEvent) => Promise<void>): void {
  if (ev.fixtureId !== canal.fixtureId) {
    canal.contadores.ignoradosDeOutrasFixtures += 1;
    return;
  }

  // Persistence precedes routing so restarts and room creation can catch up.
  let devePublicar = true;
  let matchEnded = false;
  if (ev.kind === 'score') {
    enfileirarPersistenciaAntesDePublicar(
      canal,
      async () => {
        const db = createDb();

        // Set live state only in the durable write queue.
        if (!canal.marcadaAoVivo) {
          info(`[canal-ao-vivo] PRIMEIRO score da fixture ${canal.fixtureId} — marcando 'live' no banco`);
          await createMatchRepo(db).setState(canal.fixtureId, 'live');
          canal.marcadaAoVivo = true;
        }

        const events = createEventRepo(db);
        // Leader failover redelivery must not produce a second emission.
        devePublicar = await events.upsert(ev);
        canal.contadores.persistidosScores += 1;

        // Settle pre-game picks before delivering the terminal score event.
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

          // Retire the fixture from the registry. Without this, `live_fixtures`
          // stays active forever and the 15s `sincronizarFixturesDoBanco` poll
          // recreates the channel across every restart and deploy.
          await createLiveFixtureRepo(db).deactivate(canal.fixtureId);
          matchEnded = true;
        }
      },
      async () => {
        if (devePublicar) {
          // The leader routes locally and ignores its own Redis publication.
          publicarParaSala(canal, ev);
          if (publicarDistribuido) await publicarDistribuido(ev);
        }
        if (!matchEnded) return;
        // Everything below runs even on suppressed redelivery, so a retried
        // `game_finalised` still converges the channel.
        closeLocalChannel(canal.fixtureId);
        // After publishing on purpose: a room still in memory finalizes itself
        // from `game_end` (writing its last checkpoint first), and this sweep
        // then finds only the parties a restart really orphaned.
        await reconcileOrphanedRooms(canal.fixtureId);
      },
      (erro) => registrarFalhaDePersistencia(canal, `score seq ${ev.seq}`, erro),
    );
  } else {
    enfileirarPersistenciaAntesDePublicar(
      canal,
      async () => {
        const stats = await createOddsRepo(createDb()).upsertManyRaw([ev.raw]);
        devePublicar = stats.gravados > 0;
        canal.contadores.persistidosOdds += 1;
      },
      async () => {
        if (!devePublicar) return;
        publicarParaSala(canal, ev);
        if (publicarDistribuido) await publicarDistribuido(ev);
      },
      (erro) => registrarFalhaDePersistencia(canal, `odds ${ev.messageId ?? ev.ts}`, erro),
    );
  }
}

function novoCanal(fixtureId: number): Canal {
  return {
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
      resumo: liveSummary,
      status: () => ({ scores: liveStatus.scores, odds: liveStatus.odds }),
      silencio: secondsSinceLastEvent,
    },
  };
}

function adicionarCanal(canais: Map<number, Canal>, fixtureId: number): void {
  if (canais.has(fixtureId)) return;
  const canal = novoCanal(fixtureId);
  canais.set(fixtureId, canal);
  info(`[canal-ao-vivo] fixture ${fixtureId} ativada`);
  void semear(canal);
}

/** Synchronizes dynamic fixture selection without opening another TxLINE SSE pair. */
async function sincronizarFixturesDoBanco(canais: Map<number, Canal>): Promise<void> {
  try {
    const repo = createLiveFixtureRepo(createDb());
    const [active, inactive] = await Promise.all([repo.listActive(), repo.listInactive()]);
    for (const fixture of active) adicionarCanal(canais, fixture.fixtureId);
    // Convergence for whoever did not run the terminal event: follower replicas
    // route Redis events without ever entering `aoReceber`, and a process that
    // booted after full time would otherwise recreate the channel from `listActive`.
    for (const fixtureId of channelsToClose([...canais.keys()], inactive.map((f) => f.fixtureId))) {
      closeLocalChannel(fixtureId);
    }
  } catch (e) {
    warn(`[canal-ao-vivo] não consegui sincronizar live_fixtures: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Replays durable events after Pub/Sub reconnect because Redis Pub/Sub is ephemeral. */
async function reconciliarCanaisPeloBanco(canais: Map<number, Canal>): Promise<void> {
  try {
    const db = createDb();
    for (const canal of canais.values()) {
      const [scores, odds] = await Promise.all([
        createEventRepo(db).listReplayByFixture(canal.fixtureId),
        createOddsRepo(db).listReplayByFixture(canal.fixtureId),
      ]);
      const linha = [...scores, ...odds].sort((a, b) => {
        if (a.ts !== b.ts) return a.ts - b.ts;
        if (a.kind === 'score' && b.kind !== 'score') return -1;
        if (a.kind !== 'score' && b.kind === 'score') return 1;
        if (a.kind === 'score' && b.kind === 'score') return a.seq - b.seq;
        return String((a as { messageId?: string }).messageId ?? '').localeCompare(String((b as { messageId?: string }).messageId ?? ''));
      });
      for (const event of linha) publicarParaSala(canal, event);
    }
  } catch (e) {
    warn(`[canal-ao-vivo] reconciliação Redis→Postgres falhou: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Activates a fixture in durable storage and makes it immediately local. */
export async function ativarFixtureAoVivo(fixtureId: number): Promise<boolean> {
  if (!ingestAoVivoHabilitado(process.env)) return false;
  const match = await createMatchRepo(createDb()).findById(fixtureId);
  if (!podeAtivarFixtureAoVivo(process.env, fixtureId, match)) {
    info(`[canal-ao-vivo] fixture ${fixtureId} não elegível para ativação ao vivo; ignorando`);
    return false;
  }
  iniciarCanalAoVivo();
  await createLiveFixtureRepo(createDb()).activate(fixtureId);
  return garantirCanalAoVivo(fixtureId);
}

/** Ensures a local channel only for a fixture already activated in the database. */
export async function garantirCanalAoVivo(fixtureId: number): Promise<boolean> {
  if (!ingestAoVivoHabilitado(process.env)) return false;
  iniciarCanalAoVivo();
  const canais = canaisAtivos();
  if (!canais) return false;
  if (canais.has(fixtureId)) return true;
  const ativa = (await createLiveFixtureRepo(createDb()).listActive()).some((fixture) => fixture.fixtureId === fixtureId);
  if (!ativa) return false;
  adicionarCanal(canais, fixtureId);
  return true;
}

/** Starts the live channel once when live ingest is explicitly enabled. */
export function iniciarCanalAoVivo(): void {
  if (canaisAtivos()) return;
  if (!ingestAoVivoHabilitado(process.env)) return;

  const fixtureIds = fixturesAoVivo(process.env);
  const canais = new Map<number, Canal>();
  for (const fixtureId of fixtureIds) adicionarCanal(canais, fixtureId);
  (globalThis as GlobalComCanais)[CHAVE] = canais;

  info(`[canal-ao-vivo] ligando ingest (fixtures iniciais: ${fixtureIds.join(', ') || 'nenhuma'})`);
  void sincronizarFixturesDoBanco(canais);
  const globalComCanais = globalThis as GlobalComCanais;
  const refresh = (globalComCanais[CHAVE_REFRESH] ??= setInterval(
    () => void sincronizarFixturesDoBanco(canais),
    15_000,
  ));
  refresh.unref?.();

  const broker = brokerRedisAoVivo();
  if (!broker) {
    // Compatibility mode for a single replica without Redis.
    startLiveIngest((ev) => {
      const canal = canais.get(ev.fixtureId);
      if (canal) aoReceber(canal, ev);
    });
    return;
  }

  void broker.iniciar({
    onEvent: (ev) => {
      const canal = canais.get(ev.fixtureId);
      if (canal) publicarParaSala(canal, ev);
    },
    onLeadershipChange: (lider) => {
      if (!lider) {
        // Stop immediately on lease loss to prevent concurrent TxLINE streams.
        stopLiveIngest();
        return;
      }
      info('[canal-ao-vivo] lease Redis adquirida; esta réplica iniciou o SSE TxLINE');
      startLiveIngest((ev) => {
        if (!broker.ehLider()) return;
        const canal = canais.get(ev.fixtureId);
        if (canal) aoReceber(canal, ev, (event) => broker.publicar(event));
      });
    },
    onSubscriberReady: () => void reconciliarCanaisPeloBanco(canais),
  }).catch((e: unknown) => {
    // Fail closed: without Redis, multiple replicas must not open duplicate SSE streams.
    warn(`[canal-ao-vivo] Redis indisponível; ingest distribuído não iniciado: ${e instanceof Error ? e.message : String(e)}`);
  });
}

/** Returns operational status without licensed raw payloads. */
export function statusDoCanal(): Record<string, unknown> {
  const canais = canaisAtivos();
  const canal = canais?.values().next().value as Canal | undefined;
  // Read from the bundle that started the channel to avoid split module state.
  const resumo = canal ? canal.txline.resumo() : liveSummary();
  const streams = canal ? canal.txline.status() : { scores: liveStatus.scores, odds: liveStatus.odds };
  const silencio = canal ? canal.txline.silencio : secondsSinceLastEvent;
  return {
    ativo: canais !== null,
    fixtureId: canal?.fixtureId ?? null,
    iniciadoEm: canal?.iniciadoEm ?? null,
    fixtureSemeada: canal?.semeada ?? false,
    marcadaAoVivo: canal?.marcadaAoVivo ?? false,
    resumo,
    streams,
    silencioSegundos: { scores: silencio('scores'), odds: silencio('odds') },
    contadores: canal?.contadores ?? null,
    distribuicao: brokerRedisAoVivo()?.estado() ?? { enabled: false, state: 'disabled', leader: true, lastError: null },
    fixtures: [...(canais?.values() ?? [])].map((c) => ({
      fixtureId: c.fixtureId,
      iniciadoEm: c.iniciadoEm,
      fixtureSemeada: c.semeada,
      marcadaAoVivo: c.marcadaAoVivo,
      contadores: c.contadores,
    })),
  };
}
