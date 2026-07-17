/**
 * GET/POST /api/pregame/:fixtureId — o palpite pré-jogo. Exige login.
 *
 * A identidade é o DID verificado do Bearer (CONTEXT §4) — nunca body.userId. O
 * modo demo NÃO usa esta rota: ele é 100% local (§5.1).
 *
 * GET devolve a partida, o palpite do fã (ou null), se travou (apito passou) e,
 * quando a partida encerra, LIQUIDA de forma preguiçosa: lê placar e escanteios
 * finais de match_events e credita o XP dos acertos. É idempotente (CAS em
 * settled_at), então liquidar a cada leitura não paga duas vezes.
 *
 * POST grava o palpite — recusado (409) depois do apito, porque a partir daí o
 * placar já influencia quem palpita: "justo pra todo mundo".
 */

import { NextResponse } from 'next/server';
import { gradePregame } from '@palpitei/core';
import { createEventRepo, createMatchRepo, createPregamePickRepo, createUserRepo } from '@palpitei/db';
import { createDb } from '@/server/db';
import { didVerificado, erroParaResposta } from '@/server/http';
import { fixturesTxline } from '@/server/fixtures';
import { parsePregameBody, travadoNoApito, xpEmJogo } from '@/server/pregame';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SEM_SESSAO = { error: 'sem sessão verificada — o modo demo não usa esta rota' };

function parseFixtureId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ fixtureId: string }> },
): Promise<NextResponse> {
  const did = await didVerificado(req);
  if (!did) return NextResponse.json(SEM_SESSAO, { status: 401 });

  const fixtureId = parseFixtureId((await params).fixtureId);
  if (!fixtureId) return NextResponse.json({ error: 'partida inválida' }, { status: 400 });

  const db = createDb();
  try {
    const user = await createUserRepo(db).findOrCreateByPrivyDid(did);
    const matches = createMatchRepo(db);
    // O caminho normal semeia a fixture ao carregar a Home. Este fallback cobre
    // link direto/F5 em um processo novo sem inventar dado: consulta a mesma
    // fonte TxLINE e só persiste se a fixture realmente estiver no snapshot.
    let match = await matches.findById(fixtureId);
    if (!match) {
      const fixture = (await fixturesTxline()).find((f) => f.fixtureId === fixtureId);
      if (fixture) match = await matches.upsert(fixture);
    }
    if (!match) return NextResponse.json({ error: 'partida não encontrada' }, { status: 404 });

    const estado = match.state ?? 'scheduled';
    const finished = estado === 'finished';
    const pregame = createPregamePickRepo(db);

    // Liquidação lazy: no apito final, o placar e os escanteios já estão no banco.
    let final: { goalsA: number; goalsB: number; cornersTotal: number } | null = null;
    if (finished) {
      const totais = await createEventRepo(db).totaisFinais(fixtureId);
      if (totais) {
        final = {
          goalsA: totais.goals.p1,
          goalsB: totais.goals.p2,
          cornersTotal: totais.corners.p1 + totais.corners.p2,
        };
        await pregame.settleFixture(
          fixtureId,
          { goalsP1: final.goalsA, goalsP2: final.goalsB, cornersTotal: final.cornersTotal },
          gradePregame,
        );
      }
    }

    const pick = await pregame.getByUserFixture(user.id, fixtureId);
    return NextResponse.json({
      match: {
        fixtureId,
        teamA: match.p1,
        teamB: match.p2,
        startTs: match.startTime ?? null,
        competition: match.competition ?? null,
        state: estado,
      },
      pick,
      locked: travadoNoApito({ state: estado, startTs: match.startTime ?? null }, Date.now()),
      finished,
      final,
    });
  } catch (e) {
    return erroParaResposta(e, 'ler o palpite pré-jogo');
  } finally {
    await db.close?.();
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ fixtureId: string }> },
): Promise<NextResponse> {
  const did = await didVerificado(req);
  if (!did) return NextResponse.json(SEM_SESSAO, { status: 401 });

  const fixtureId = parseFixtureId((await params).fixtureId);
  if (!fixtureId) return NextResponse.json({ error: 'partida inválida' }, { status: 400 });

  const parsed = parsePregameBody(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const db = createDb();
  try {
    const user = await createUserRepo(db).findOrCreateByPrivyDid(did);
    const matches = createMatchRepo(db);
    let match = await matches.findById(fixtureId);
    if (!match) {
      const fixture = (await fixturesTxline()).find((f) => f.fixtureId === fixtureId);
      if (fixture) match = await matches.upsert(fixture);
    }
    if (!match) return NextResponse.json({ error: 'partida não encontrada' }, { status: 404 });

    // A trava no apito é servidor: o cliente pode mentir o horário, o banco não.
    if (travadoNoApito({ state: match.state ?? 'scheduled', startTs: match.startTime ?? null }, Date.now())) {
      return NextResponse.json({ error: 'os palpites travam no apito inicial' }, { status: 409 });
    }

    const pick = await createPregamePickRepo(db).upsert(user.id, fixtureId, parsed.fields);
    return NextResponse.json({ ok: true, pick, xpEmJogo: xpEmJogo(parsed.fields) });
  } catch (e) {
    return erroParaResposta(e, 'salvar o palpite pré-jogo');
  } finally {
    await db.close?.();
  }
}
