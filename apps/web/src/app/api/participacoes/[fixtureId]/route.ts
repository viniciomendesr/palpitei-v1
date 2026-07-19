/**
 * The fan's own palpites in a fixture, served from PERSISTED data.
 *
 * Deliberately not backed by a live room: opening a room to read a summary would
 * start a `ReplayRunner` over a finished match and write a new run, which is the
 * opposite of showing the run that already happened.
 *
 * Only the FIRST participation is served. `pickFirstParticipation` owns that
 * rule and is tested separately; this route only supplies it with runs and
 * renders the winner.
 */

import { NextResponse } from 'next/server';
import {
  createEventRepo,
  createMatchRepo,
  createParticipationRepo,
  createUserRepo,
} from '@palpitei/db';
import { createDb } from '@/server/db';
import { didVerificado, erroParaResposta } from '@/server/http';
import { pickFirstParticipation } from '@/server/participacao';
import type { ApiParticipation } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ fixtureId: string }> },
): Promise<NextResponse> {
  const did = await didVerificado(req);
  if (!did) {
    return NextResponse.json(
      { error: 'sem sessão verificada — o modo demo não usa esta rota' },
      { status: 401 },
    );
  }

  const { fixtureId: bruto } = await ctx.params;
  const fixtureId = Number(bruto);
  if (!Number.isInteger(fixtureId) || fixtureId <= 0) {
    return NextResponse.json({ error: 'fixture inválida' }, { status: 400 });
  }

  const db = createDb();
  try {
    const user = await createUserRepo(db).findOrCreateByPrivyDid(did);
    const participacoes = createParticipationRepo(db);
    const primeira = pickFirstParticipation(await participacoes.listRuns(user.id, fixtureId));
    if (!primeira) {
      return NextResponse.json(
        { error: 'você ainda não palpitou nesta partida' },
        { status: 404 },
      );
    }

    const eventos = createEventRepo(db);
    const [match, picks, players, totals] = await Promise.all([
      createMatchRepo(db).findById(fixtureId),
      participacoes.listPicks(user.id, fixtureId, primeira.runId),
      participacoes.countPlayers(fixtureId, primeira.runId),
      eventos.totaisAcumulados(fixtureId),
    ]);
    if (!match) {
      return NextResponse.json({ error: 'partida não está no banco' }, { status: 404 });
    }

    const resposta: ApiParticipation = {
      fixtureId,
      teamA: match.p1,
      teamB: match.p2,
      live: primeira.live,
      at: primeira.firstAt,
      // Goals come from the merged totals for the same reason the room does it:
      // the key set is partial, so a missing key was never reported.
      score: { p1: totals.p1.Goals ?? 0, p2: totals.p2.Goals ?? 0 },
      totals,
      picks,
      players,
    };
    return NextResponse.json(resposta);
  } catch (e) {
    return erroParaResposta(e, `GET /api/participacoes/${fixtureId}`);
  } finally {
    await db.close?.();
  }
}
