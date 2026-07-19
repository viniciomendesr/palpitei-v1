
import { NextResponse } from 'next/server';
import { createTrophyRepo, createUserRepo } from '@palpitei/db';
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
    const top = await repo.topRanking(TOP);

    type Linha = {
      pos: number | null;
      name: string;
      xp: number;
      level: number;
      trophies: number;
      me: boolean;
    };
    const rows: Linha[] = top.map((r, i) => ({
      pos: i + 1,
      name: r.handle,
      xp: r.xp,
      level: r.level,
      trophies: r.trophies,
      me: r.userId === eu.id,
    }));

    if (!rows.some((r) => r.me)) {
      // The appended row is built from `users`, which knows nothing about the ledger.
      // Reading the balance here costs one extra query for one fan (never per row) and
      // is what keeps a fan outside the top 50 from being told they hold zero trophies
      // when they hold some.
      const trophies = await createTrophyRepo(db).balance(eu.id);
      rows.push({
        pos: null,
        name: eu.handle ?? '',
        xp: eu.xp,
        level: eu.level,
        trophies,
        me: true,
      });
    }

    return NextResponse.json({ rows });
  } catch (e) {
    return erroParaResposta(e, 'GET /api/ranking');
  } finally {
    await db.close?.();
  }
}
