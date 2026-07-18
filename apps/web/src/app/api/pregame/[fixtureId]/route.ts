
import { NextResponse } from 'next/server';
import { gradePregame } from '@palpitei/core';
import { createEventRepo, createMatchRepo, createPregamePickRepo, createUserRepo } from '@palpitei/db';
import { createDb } from '@/server/db';
import { didVerificado, erroParaResposta } from '@/server/http';
import { fixturesTxline } from '@/server/fixtures';
import { parsePregameBody, isLockedAtKickoff, xpAtStake } from '@/server/pregame';
import { marketById, matchesMarketLine, fetchPregameOdds, NO_PREGAME_MARKETS } from '@/server/pregameOdds';

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
    let match = await matches.findById(fixtureId);
    if (!match) {
      const fixture = (await fixturesTxline()).find((f) => f.fixtureId === fixtureId);
      if (fixture) match = await matches.upsert(fixture);
    }
    if (!match) return NextResponse.json({ error: 'partida não encontrada' }, { status: 404 });

    const estado = match.state ?? 'scheduled';
    const finished = estado === 'finished';
    const pregame = createPregamePickRepo(db);

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
    const cotacoes = finished
      ? { markets: NO_PREGAME_MARKETS, txlineAvailable: false }
      : await fetchPregameOdds(fixtureId);
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
      markets: cotacoes.markets,
      txlineOddsAvailable: cotacoes.txlineAvailable,
      locked: isLockedAtKickoff({ state: estado, startTs: match.startTime ?? null }, Date.now()),
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

    if (isLockedAtKickoff({ state: match.state ?? 'scheduled', startTs: match.startTime ?? null }, Date.now())) {
      return NextResponse.json({ error: 'os palpites travam no apito inicial' }, { status: 409 });
    }

    const dependeDeCotacao = parsed.fields.result !== null || parsed.fields.goals !== null || parsed.fields.corners !== null;
    if (dependeDeCotacao) {
      const cotacoes = await fetchPregameOdds(fixtureId);
      if (!cotacoes.txlineAvailable) {
        return NextResponse.json({ error: 'as cotações da TxLINE não estão disponíveis agora; tente de novo' }, { status: 503 });
      }
      if (parsed.fields.result !== null && !marketById(cotacoes.markets, 'result')) {
        return NextResponse.json({ error: 'a TxLINE não trouxe cotação de resultado para esta partida' }, { status: 409 });
      }
      if (parsed.fields.goals !== null && !matchesMarketLine(parsed.fields.goalsLine, marketById(cotacoes.markets, 'goals'))) {
        return NextResponse.json({ error: 'a cotação de gols mudou; atualize a tela antes de confirmar' }, { status: 409 });
      }
      if (parsed.fields.corners !== null && !matchesMarketLine(parsed.fields.cornersLine, marketById(cotacoes.markets, 'corners'))) {
        return NextResponse.json({ error: 'a cotação de escanteios mudou; atualize a tela antes de confirmar' }, { status: 409 });
      }
    }

    const pick = await createPregamePickRepo(db).upsert(user.id, fixtureId, parsed.fields);
    return NextResponse.json({ ok: true, pick, xpAtStake: xpAtStake(parsed.fields) });
  } catch (e) {
    return erroParaResposta(e, 'salvar o palpite pré-jogo');
  } finally {
    await db.close?.();
  }
}
