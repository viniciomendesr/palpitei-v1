// Stores the complete match timeline so replay does not depend on the devnet.
//
// Uso:
//   npm run cache:match -w @palpitei/txline -- <fixtureId>          (cache do @palpitei/db)
//   npm run cache:match -w @palpitei/txline -- <fixtureId> --file   (arquivo, dev offline)
//
// TxLINE data is licensed for the hackathon only. Production persistence uses
// Postgres; `--file` writes only to the ignored local cache.

import { ensureJwt } from "../src/auth.ts";
import {
  fetchFixtureNames,
  fetchOddsUpdates,
  fetchScoresUpdates,
  fetchScoresSnapshot,
} from "../src/api.ts";
import { adaptDbCacheStore, createFileMatchCacheStore, type MatchCacheStore } from "../src/cache.ts";

const PADRAO = 18241006;

type StoreResolvido = { store: MatchCacheStore; onde: string; close?: () => Promise<void> };

/**
 * Uses the @palpitei/db store when DATABASE_URL is available; otherwise writes
 * a local file for offline development. The dynamic import keeps db optional.
 * The adapter preserves the txline cache-store contract over db repositories.
 */
async function resolveStore(forcaArquivo: boolean): Promise<StoreResolvido> {
  if (!forcaArquivo) {
    if (!process.env.DATABASE_URL?.trim()) {
      console.warn("DATABASE_URL vazia — caindo para arquivo (dev offline). Use --file para calar este aviso.");
    } else {
      try {
        // Keep the module specifier dynamic so file mode does not require db.
        const especificador = "@palpitei/db";
        const db: any = await import(especificador);
        if (typeof db.createPalpitei !== "function") {
          throw new TypeError("@palpitei/db não expõe createPalpitei()");
        }
        const palpitei = db.createPalpitei();
        return {
          store: adaptDbCacheStore(palpitei.cache),
          onde: "Postgres (@palpitei/db)",
          close: () => palpitei.close(),
        };
      } catch (e: any) {
        console.warn(`@palpitei/db indisponível (${e?.message ?? e}) — caindo para arquivo (dev offline).`);
      }
    }
  }
  const path = await import("node:path");
  const url = await import("node:url");
  const dir = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../.cache/fixtures");
  return { store: createFileMatchCacheStore(dir), onde: `arquivo em ${dir}` };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const forcaArquivo = args.includes("--file");
  const idArg = args.find((a) => !a.startsWith("--"));
  const fixtureId = Number(idArg ?? PADRAO);

  if (!Number.isInteger(fixtureId) || fixtureId <= 0) {
    console.error(`fixtureId inválido: ${idArg}`);
    process.exit(1);
  }

  await ensureJwt();

  // Score rows retain start time after the fixture leaves the snapshot.
  const amostra = await fetchScoresSnapshot(fixtureId);
  const startTime = Number(amostra.find((l: any) => l?.StartTime)?.StartTime);
  if (!Number.isFinite(startTime)) {
    console.error(`não achei StartTime para ${fixtureId} — a devnet ainda serve essa fixture?`);
    process.exit(1);
  }
  const nomes = (await fetchFixtureNames(fixtureId)) ?? { p1: "Time 1", p2: "Time 2" };
  const { store, onde, close } = await resolveStore(forcaArquivo);

  console.log(`fixture ${fixtureId} — ${nomes.p1} vs ${nomes.p2}`);
  console.log(`kickoff: ${new Date(startTime).toISOString()}`);
  console.log(`destino: ${onde}`);
  console.log(`varrendo /updates (~144 requisições)…\n`);

  const [scores, odds] = await Promise.all([
    fetchScoresUpdates(fixtureId, startTime),
    fetchOddsUpdates(fixtureId, startTime),
  ]);

  if (!scores.length) {
    console.error("nenhum evento de placar — nada a gravar.");
    process.exit(1);
  }

  await store.put({
    fixtureId,
    p1: nomes.p1,
    p2: nomes.p2,
    startTime,
    gravadoEm: Date.now(),
    fonte: "txline-updates",
    scores,
    odds,
  });

  const apito = scores.find((s: any) => s?.Action === "kickoff" && s?.Clock?.Seconds === 0);
  const fim = scores.find((s: any) => s?.Action === "game_finalised");
  const gols = scores.filter((s: any) => s?.Action === "goal").length;

  console.log(`\n=== gravado em ${onde} ===`);
  console.log(`  scores: ${scores.length} (seq ${scores[0].Seq} -> ${scores[scores.length - 1].Seq})`);
  console.log(`  odds 1X2: ${odds.length}`);
  console.log(`  apito inicial: ${apito ? `seq ${apito.Seq} (clock 0)` : "NÃO ENCONTRADO"}`);
  console.log(`  game_finalised: ${fim ? `seq ${fim.Seq} — use este seq na prova de Merkle` : "ausente"}`);
  console.log(`  registros de gol: ${gols}`);
  console.log(`\nO replay usa o cache automaticamente. Não versione payload da TxLINE (T&C §7).`);

  // Sem isto o pool do pg segura o processo aberto depois de gravar.
  await close?.();
}

main().catch((e) => {
  console.error("ERRO:", e?.message ?? e);
  process.exit(1);
});
