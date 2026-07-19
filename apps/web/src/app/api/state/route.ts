
import { NextResponse } from 'next/server';
import { createLeagueRepo, createPredictionRepo, createTrophyRepo, createUserRepo } from '@palpitei/db';
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
    const [aproveitamento, leaguesCount, trophies] = await Promise.all([
      createPredictionRepo(db).estatisticas(user.id),
      createLeagueRepo(db).countForUser(user.id),
      // Trophies travel with XP because the store spends them like XP. Leaving
      // them out is what made the store show 0 to a fan the ranking credited.
      createTrophyRepo(db).balance(user.id),
    ]);

    return NextResponse.json({
      user: {
        privyDid: did,
        nickname: user.handle,
        level: user.level,
        xp: user.xp,
        streak: user.currentStreak,
        trophies,
        wallet: user.wallet,
        walletSource: user.walletSource,
      },
      leaguesCount,
      isPremium: user.isPremium,
      stats: aproveitamento,
    });
  } catch (e) {
    return erroParaResposta(e, 'GET /api/state');
  } finally {
    await db.close?.();
  }
}
