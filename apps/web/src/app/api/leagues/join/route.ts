
import { NextResponse } from 'next/server';
import { createLeagueRepo, createUserRepo } from '@palpitei/db';
import { createDb } from '@/server/db';
import { didVerificado, erroParaResposta } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  const did = await didVerificado(req);
  if (!did) {
    return NextResponse.json(
      { error: 'sem sessão verificada — o modo demo não usa esta rota' },
      { status: 401 },
    );
  }

  const body: unknown = await req.json().catch(() => null);
  const code = (body as { code?: unknown } | null)?.code;
  if (typeof code !== 'string') {
    return NextResponse.json({ error: 'cola aí o código que te mandaram' }, { status: 400 });
  }

  const db = createDb();
  try {
    const user = await createUserRepo(db).findOrCreateByPrivyDid(did);
    const liga = await createLeagueRepo(db).joinByCode(user.id, code);
    return NextResponse.json({
      ok: true,
      league: { id: liga.id, name: liga.name, memberCount: liga.memberCount },
    });
  } catch (e) {
    return erroParaResposta(e, 'POST /api/leagues/join');
  } finally {
    await db.close?.();
  }
}
