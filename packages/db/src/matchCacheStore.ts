// matchCacheStore — a timeline completa de uma partida, no Postgres.
//
// Substitui o `.cache/fixtures/*.json` do v0. Não é preferência de arquitetura:
// o T&C §7 licencia o dado da TxLINE só para o hackathon e PROÍBE
// redistribuição — e este repositório é público. Payload da TxLINE não pode ser
// versionado. No banco pode.
//
// De quebra resolve o que o cache em disco resolvia (o dataset da devnet
// ROTACIONA — achado A1: se você não gravou, perdeu) sem depender do disco da
// máquina que estiver rodando a demo.
//
// O armazenamento reaproveita `match_events` e `match_odds`: a timeline JÁ é
// isso. Guardar um segundo blob JSON ao lado seria manter duas verdades — e
// ganhar de graça a idempotência por (fixture_id, seq) e a detecção de buracos.

import type { Db } from './pool.js';
import type { CacheSource, MatchCache } from './types.js';
import { createEventRepo } from './repos/eventRepo.js';
import { createMatchRepo } from './repos/matchRepo.js';
import { createOddsRepo } from './repos/oddsRepo.js';

export type SaveCacheStats = {
  fixtureId: number;
  scoresGravados: number;
  scoresRepetidos: number;
  oddsGravadas: number;
  oddsRepetidas: number;
  oddsForaDoMercado: number;
  buracos: { de: number; ate: number; faltam: number }[];
};

export function createMatchCacheStore(db: Db) {
  const matches = createMatchRepo(db);
  const events = createEventRepo(db);
  const odds = createOddsRepo(db);

  const store = {
    /**
     * Grava a timeline. Idempotente: rodar duas vezes não duplica nada.
     *
     * Recusa cache sem `startTime` — a mesma trava que o `cache-match.ts` do v0
     * tinha, e pelo mesmo motivo (G4): sem o horário do apito, a janela do
     * desafio "como termina?" ancora no 1º evento do feed, que sai até 44 min
     * antes da bola rolar, e o desafio nasce fechado. Falha silenciosa clássica:
     * a sala abre, a partida roda, e ninguém palpita. Melhor recusar aqui, alto.
     */
    async save(cache: MatchCache): Promise<SaveCacheStats> {
      if (!Number.isFinite(cache.startTime) || cache.startTime <= 0) {
        throw new Error(
          `[cache] fixture ${cache.fixtureId} sem startTime — recusado. ` +
            `Sem o horário do apito a janela do desafio final nasce fechada (G4).`
        );
      }
      if (!Array.isArray(cache.scores) || cache.scores.length === 0) {
        throw new Error(`[cache] fixture ${cache.fixtureId} sem eventos de placar — nada a gravar.`);
      }

      await matches.upsert(
        {
          fixtureId: cache.fixtureId,
          p1: cache.p1,
          p2: cache.p2,
          startTime: cache.startTime,
        },
        { source: cache.fonte, cachedAt: cache.gravadoEm }
      );

      const s = await events.upsertManyRaw(cache.scores);
      const o = await odds.upsertManyRaw(cache.odds ?? []);
      const buracos = await events.findSeqGaps(cache.fixtureId);

      return {
        fixtureId: cache.fixtureId,
        scoresGravados: s.gravados,
        scoresRepetidos: s.repetidos,
        oddsGravadas: o.gravados,
        oddsRepetidas: o.repetidos,
        oddsForaDoMercado: o.foraDoMercado,
        buracos,
      };
    },

    /**
     * Lê a timeline gravada. `null` quando não há o que reproduzir — mesmo
     * contrato do `lerCache` do v0, para o replay poder cair na API.
     */
    async load(fixtureId: number): Promise<MatchCache | null> {
      const match = await matches.findById(fixtureId);
      if (!match) return null;

      const scores = await events.listRaw(fixtureId);
      if (scores.length === 0) return null;

      const oddsRaw = await odds.listRaw(fixtureId);

      // gravadoEm é QUANDO A TIMELINE FOI GRAVADA, não agora. Devolver Date.now()
      // aqui faria todo cache parecer recém-gravado — e a idade do cache é
      // justamente o que diz se ele ainda vale (a devnet rotaciona, A1).
      const [meta] = await db.query(
        `select extract(epoch from cached_at) * 1000 as gravado_ms, cache_source
           from matches where fixture_id = $1`,
        [fixtureId]
      );

      if (match.startTime == null) {
        // Não dá para inventar: derivar o "início" do 1º evento é exatamente o
        // G4. Melhor gritar e deixar o consumidor decidir.
        console.warn(
          `[cache] fixture ${fixtureId} está sem start_ts no banco — ` +
            `a janela do desafio final vai ancorar no 1º evento (G4).`
        );
      }

      return {
        fixtureId,
        p1: match.p1,
        p2: match.p2,
        startTime: match.startTime ?? 0,
        gravadoEm: meta?.gravado_ms == null ? 0 : Math.round(Number(meta.gravado_ms)),
        fonte: (meta?.cache_source as CacheSource | null) ?? 'txline-cache',
        scores,
        odds: oddsRaw,
      };
    },

    /** Fixtures com timeline gravada — as que dão replay sem tocar na devnet. */
    async list(): Promise<number[]> {
      const rows = await db.query(
        `select distinct fixture_id from match_events order by fixture_id`
      );
      return rows.map((r) => Number(r.fixture_id));
    },

    async has(fixtureId: number): Promise<boolean> {
      const rows = await db.query(
        `select 1 from match_events where fixture_id = $1 limit 1`,
        [fixtureId]
      );
      return rows.length > 0;
    },

    /** Resumo do que está gravado — para a tela de replays e para conferir a ingestão. */
    async stats(fixtureId: number): Promise<{
      scores: number;
      odds: number;
      seqDe: number | null;
      seqAte: number | null;
      buracos: number;
      fonte: CacheSource | null;
    }> {
      const [r] = await db.query(
        `select (select count(*)::int from match_events where fixture_id = $1) as scores,
                (select count(*)::int from match_odds   where fixture_id = $1) as odds,
                (select min(seq)::int from match_events where fixture_id = $1) as seq_de,
                (select max(seq)::int from match_events where fixture_id = $1) as seq_ate,
                (select cache_source from matches where fixture_id = $1) as fonte`,
        [fixtureId]
      );
      const buracos = await events.findSeqGaps(fixtureId);
      return {
        scores: Number(r?.scores ?? 0),
        odds: Number(r?.odds ?? 0),
        seqDe: r?.seq_de == null ? null : Number(r.seq_de),
        seqAte: r?.seq_ate == null ? null : Number(r.seq_ate),
        buracos: buracos.length,
        fonte: (r?.fonte as CacheSource | null) ?? null,
      };
    },
  };

  // Apelidos com os nomes do v0 (salvarCache/lerCache/listarCache). O pacote
  // @palpitei/txline está sendo escrito em paralelo; expor os dois vocabulários
  // faz a interface casar estruturalmente com qualquer um dos dois nomes, sem
  // acoplar os builds.
  return Object.assign(store, {
    salvarCache: store.save,
    lerCache: store.load,
    listarCache: store.list,
  });
}

export type MatchCacheStore = ReturnType<typeof createMatchCacheStore>;
