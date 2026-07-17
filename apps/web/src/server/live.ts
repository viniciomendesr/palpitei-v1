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
import { classificarParaSala, eventoEncerraPartida, fixtureAoVivo } from './live-regras';

type Contadores = {
  ignoradosDeOutrasFixtures: number;
  foraDoMercado: number;
  roteadosParaSala: number;
  persistidosScores: number;
  persistidosOdds: number;
  falhasDePersistencia: number;
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

const CHAVE = '__palpitei_canal_ao_vivo__' as const;
type GlobalComCanal = typeof globalThis & { [CHAVE]?: Canal };

const canalAtivo = (): Canal | null => (globalThis as GlobalComCanal)[CHAVE] ?? null;

/** A fixture do canal ativo — é por ela que `criarSala` decide o ramo live. */
export function fixtureDoCanal(): number | null {
  return canalAtivo()?.fixtureId ?? null;
}

/**
 * A sala live registra aqui o MESMO `processarEvento` que o ReplayRunner usa.
 * Devolve o unsubscribe; null quando o canal não está ligado (flags fechadas).
 */
export function assinarCanalAoVivo(
  fixtureId: number,
  handler: (ev: NormEvent) => void,
): (() => void) | null {
  const canal = canalAtivo();
  if (!canal || canal.fixtureId !== fixtureId) return null;
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

/** Enfileira uma escrita; erro vira contador + log alto, nunca silêncio. */
function persistir(canal: Canal, oQue: string, op: () => Promise<unknown>): void {
  canal.fila = canal.fila
    .then(op)
    .then(() => undefined)
    .catch((e) => {
      canal.contadores.falhasDePersistencia += 1;
      warn(
        `[canal-ao-vivo] FALHA DE PERSISTÊNCIA (${oQue}, #${canal.contadores.falhasDePersistencia}): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    });
}

function aoReceber(canal: Canal, ev: NormEvent): void {
  if (ev.fixtureId !== canal.fixtureId) {
    canal.contadores.ignoradosDeOutrasFixtures += 1;
    return;
  }

  // O primeiro evento DE SCORE da fixture-alvo marca a partida como 'live' no
  // banco — o cinto de segurança da listagem. Só score, e foi medido, não
  // teoria: no dry-run de 17/07 a devnet mandou odds PRÉ-JOGO ~26h antes do
  // apito, e a versão que marcava em qualquer evento rotulou como "ao vivo"
  // uma partida que só começa amanhã. Score só existe com jogo rolando.
  if (!canal.marcadaAoVivo && ev.kind === 'score') {
    canal.marcadaAoVivo = true;
    info(`[canal-ao-vivo] PRIMEIRO evento da fixture ${canal.fixtureId} — marcando 'live' no banco`);
    persistir(canal, 'setState live', () =>
      createMatchRepo(createDb()).setState(canal.fixtureId, 'live'),
    );
  }

  // Persistência ANTES do roteamento: a sala pode nem existir ainda, e o dado
  // gravado é o que sobrevive a restart (A1). Odds grava TODO mercado da
  // fixture — o upsertManyRaw filtra com eh1x2JogoInteiro, o mesmo critério da
  // projeção que o replay lê; o raw dos demais fica para estudo pós-jogo.
  if (ev.kind === 'score') {
    persistir(canal, `score seq ${ev.seq}`, async () => {
      const db = createDb();
      const events = createEventRepo(db);
      await events.upsert(ev);
      canal.contadores.persistidosScores += 1;

      // A liquidação pré-jogo não pode depender de uma sala estar aberta nem
      // de um fã voltar à tela depois do apito. A fila já garantiu que todos os
      // scores anteriores foram persistidos; `totaisFinais` preserva a última
      // leitura conhecida quando o próprio game_finalised não traz Score.
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
    });
  } else {
    persistir(canal, `odds ${ev.messageId ?? ev.ts}`, async () => {
      await createOddsRepo(createDb()).upsertManyRaw([ev.raw]);
      canal.contadores.persistidosOdds += 1;
    });
  }

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
 * Liga o canal. Idempotente; um no-op silencioso quando as travas estão
 * fechadas (env ausente = DESLIGADO — a 3ª trava, live-regras.ts). É chamada
 * pelo `instrumentation.ts` no boot e, como plano B, na primeira linha do
 * GET /api/live/status.
 */
export function iniciarCanalAoVivo(): void {
  if (canalAtivo()) return;
  const fixtureId = fixtureAoVivo(process.env);
  if (!fixtureId) return;

  const canal: Canal = {
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
      errosDeHandler: 0,
    },
    handlers: new Set(),
    fila: Promise.resolve(),
    txline: {
      resumo: liveResumo,
      status: () => ({ scores: liveStatus.scores, odds: liveStatus.odds }),
      silencio: segundosEmSilencio,
    },
  };
  (globalThis as GlobalComCanal)[CHAVE] = canal;

  info(`[canal-ao-vivo] ligando: fixture ${fixtureId} (TXLINE_LIVE_INGEST=true)`);
  void semear(canal);
  startLiveIngest((ev) => aoReceber(canal, ev));
}

/** O LiveStatus SEM a amostra crua: payload da TxLINE não sai por rota pública (§7). */
function semAmostra(s: LiveStatus): Omit<LiveStatus, 'ultimaAmostra'> {
  const { ultimaAmostra: _descartada, ...resto } = s;
  return resto;
}

/** O painel do runbook — tudo que os olhos precisam, nada que o §7 proíbe. */
export function statusDoCanal(): Record<string, unknown> {
  const canal = canalAtivo();
  // Canal ligado: ler pelo bundle que LIGOU (canal.txline) — o import local
  // deste arquivo pode ser a outra instância do módulo, com contadores zerados.
  const resumo = canal ? canal.txline.resumo() : liveResumo();
  const streams = canal ? canal.txline.status() : { scores: liveStatus.scores, odds: liveStatus.odds };
  const silencio = canal ? canal.txline.silencio : segundosEmSilencio;
  return {
    ativo: canal !== null,
    fixtureId: canal?.fixtureId ?? null,
    iniciadoEm: canal?.iniciadoEm ?? null,
    fixtureSemeada: canal?.semeada ?? false,
    marcadaAoVivo: canal?.marcadaAoVivo ?? false,
    resumo,
    streams: { scores: semAmostra(streams.scores), odds: semAmostra(streams.odds) },
    silencioSegundos: { scores: silencio('scores'), odds: silencio('odds') },
    contadores: canal?.contadores ?? null,
  };
}
