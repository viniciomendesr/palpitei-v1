
import { NextResponse } from 'next/server';
import { createUserRepo } from '@palpitei/db';
import { createDb } from '@/server/db';
import { didVerificado, erroParaResposta } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TOP = 50;

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
    const repo = createUserRepo(db);
    const eu = await repo.findOrCreateByPrivyDid(did);
    const top = await repo.topByXp(TOP);

    type Linha = { pos: number | null; name: string; xp: number; level: number; me: boolean };
    const rows: Linha[] = top.map((r, i) => ({
      pos: i + 1,
      name: r.handle,
      xp: r.xp,
      level: r.level,
      me: r.userId === eu.id,
    }));

    if (!rows.some((r) => r.me)) {
      rows.push({ pos: null, name: eu.handle ?? '', xp: eu.xp, level: eu.level, me: true });
    }

    return NextResponse.json({ rows });
  } catch (e) {
    return erroParaResposta(e, 'GET /api/ranking');
  } finally {
    await db.close?.();
  }
}
