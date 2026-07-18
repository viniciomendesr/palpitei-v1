
import { NextResponse } from 'next/server';
import { createLeagueRepo, createUserRepo, LIGAS_FREE } from '@palpitei/db';
import { createDb } from '@/server/db';
import { didVerificado, erroParaResposta } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
    const ligas = createLeagueRepo(db);
    const minhas = await ligas.listForUser(user.id);
    const criadas = minhas.reduce((n, liga) => n + (liga.iLead ? 1 : 0), 0);

    return NextResponse.json({
      leagues: minhas.map((l) => ({
        id: l.id,
        name: l.name,
        memberCount: l.memberCount,
        iLead: l.iLead,
        inviteCode: l.inviteCode,
      })),
      ownedCount: criadas,
      freeLimit: LIGAS_FREE,
      isPremium: user.isPremium,
    });
  } catch (e) {
    return erroParaResposta(e, 'GET /api/leagues');
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

  const body: unknown = await req.json().catch(() => null);
  const name = (body as { name?: unknown } | null)?.name;
  if (typeof name !== 'string') {
    return NextResponse.json({ error: 'dá um nome pra sua liga' }, { status: 400 });
  }

  const db = createDb();
  try {
    const user = await createUserRepo(db).findOrCreateByPrivyDid(did);
    const liga = await createLeagueRepo(db).create(user.id, name);
    return NextResponse.json({ ok: true, league: { ...liga, iLead: true } }, { status: 201 });
  } catch (e) {
    return erroParaResposta(e, 'POST /api/leagues');
  } finally {
    await db.close?.();
  }
}
