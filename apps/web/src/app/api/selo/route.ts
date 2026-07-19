/**
 * The fan's TxLINE Seal: read it, and reveal it.
 *
 * NOTHING HERE TOUCHES THE CHAIN, and the copy on top of it must not say
 * otherwise. The asset was minted by an offline backfill run by a human with
 * their own key (`packages/selo/scripts/mint-selo.ts`); `selo_mints` is that
 * receipt. `POST` writes `revealed_at` and returns the address the fan already
 * owns. A button that claimed to be minting would be a provenance label that
 * lies, on the one object whose whole point is provenance.
 *
 * One Seal per fan by construction: it commemorates their FIRST palpite in a
 * live match, right or wrong. There is no list here.
 */

import { NextResponse } from 'next/server';
import {
  createMatchRepo,
  createPredictionRepo,
  createQuestionRepo,
  createTrophyRepo,
  createUserRepo,
} from '@palpitei/db';
import type { Db, SeloMint } from '@palpitei/db';
import { createDb } from '@/server/db';
import { didVerificado, erroParaResposta } from '@/server/http';
import type { ApiSelo } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Builds the client view, resolving what the fan actually chose when they palpitou. */
async function seloDoFa(db: Db, mint: SeloMint | null): Promise<ApiSelo> {
  // A row without an asset address is not something the fan can be shown as
  // theirs: `pending` means a human still has to read the explorer.
  if (!mint?.assetPubkey) return { seal: null };

  const question = await createQuestionRepo(db).findById(mint.questionId);
  const match = question ? await createMatchRepo(db).findById(question.fixtureId) : null;
  // The label is the fan's OWN choice, never the correct option: the Seal marks
  // that they were there, and a debut palpite is often wrong. Showing the right
  // answer here would read as a boast the badge does not make.
  const palpites = await createPredictionRepo(db).listByQuestion(mint.questionId);
  const meu = palpites.find((p) => p.userId === mint.userId);
  const escolha = question?.options.find((o) => o.id === meu?.choice);

  return {
    seal: {
      assetPubkey: mint.assetPubkey,
      cluster: mint.cluster,
      prompt: question?.prompt ?? '',
      choiceLabel: escolha?.label ?? meu?.choice ?? '',
      teamA: match?.p1 ?? '',
      teamB: match?.p2 ?? '',
      revealedAt: mint.revealedAt ?? null,
    },
  };
}

export async function GET(req: Request): Promise<NextResponse> {
  const did = await didVerificado(req);
  if (!did) {
    return NextResponse.json(
      { error: 'sem sessão verificada — o modo demo não usa esta rota' },
      { status: 401 },
    );
  }

  const db = createDb();
  try {
    const user = await createUserRepo(db).findOrCreateByPrivyDid(did);
    const mint = await createTrophyRepo(db).findMintedSelo(user.id);
    return NextResponse.json(await seloDoFa(db, mint));
  } catch (e) {
    return erroParaResposta(e, 'GET /api/selo');
  } finally {
    await db.close?.();
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const did = await didVerificado(req);
  if (!did) {
    return NextResponse.json(
      { error: 'sem sessão verificada — o modo demo não usa esta rota' },
      { status: 401 },
    );
  }

  const db = createDb();
  try {
    const user = await createUserRepo(db).findOrCreateByPrivyDid(did);
    const trophies = createTrophyRepo(db);
    const mint = await trophies.findMintedSelo(user.id);
    if (!mint?.assetPubkey) {
      return NextResponse.json({ error: 'você ainda não tem um Selo' }, { status: 404 });
    }
    // Idempotent: revealing twice keeps the first timestamp.
    const revealedAt = await trophies.revealSelo(user.id, mint.id);
    return NextResponse.json(await seloDoFa(db, { ...mint, revealedAt }));
  } catch (e) {
    return erroParaResposta(e, 'POST /api/selo');
  } finally {
    await db.close?.();
  }
}
