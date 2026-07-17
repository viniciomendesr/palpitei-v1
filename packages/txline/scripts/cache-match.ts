// Grava a linha do tempo COMPLETA de uma partida, para o replay não depender da
// devnet no dia da demo (o dataset ROTACIONA — A1).
//
// Uso:
//   npm run cache:match -w @palpitei/txline -- <fixtureId>          (cache do @palpitei/db)
//   npm run cache:match -w @palpitei/txline -- <fixtureId> --file   (arquivo, dev offline)
//
// O dado é da TxLINE: o T&C §7 licencia só para o hackathon e proíbe
// redistribuição. Em produção o cache é o POSTGRES; o --file grava em .cache/,
// que está no .gitignore e NÃO pode ir para o repositório público.

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
 * O store do @palpitei/db se ele existir E houver DATABASE_URL; senão, arquivo
 * (dev offline). O import é dinâmico porque o db é opcional para este script.
 *
 * ATENÇÃO ao que já deu errado aqui: `createMatchCacheStore()` EXIGE uma conexão
 * `Db`. Chamado sem argumento ele não explode — devolve um store cujas queries só
 * quebram na primeira leitura. E o vocabulário do db é load/save, não get/put:
 * usar o objeto direto como se fosse esta porta faz `put` ser `undefined` e o
 * script morrer DEPOIS das ~144 requisições, jogando a varredura fora. Por isso
 * aqui se monta a camada de verdade (createPalpitei) e se adapta explicitamente.
 */
async function resolveStore(forcaArquivo: boolean): Promise<StoreResolvido> {
  if (!forcaArquivo) {
    if (!process.env.DATABASE_URL?.trim()) {
      console.warn("DATABASE_URL vazia — caindo para arquivo (dev offline). Use --file para calar este aviso.");
    } else {
      try {
        // Especificador em variável de propósito: o db é OPCIONAL para este
        // script (ele roda offline com --file). Import literal faria o tsc
        // exigir o build do db para typecheckar o txline — acoplamento que não
        // queremos.
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

  // O StartTime vem das próprias linhas de score: a fixture pode já ter sumido
  // do /fixtures/snapshot e ainda ter dados (A1).
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
