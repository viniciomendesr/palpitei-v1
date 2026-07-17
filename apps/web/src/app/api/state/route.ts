/**
 * GET /api/state — o fã como o BANCO o conhece: apelido, XP, nível, sequência,
 * time do coração, aproveitamento dos palpites e as ligas.
 *
 * É a rota que faltava para a sessão local parar de mentir: o apelido e o XP
 * sempre foram persistidos (o motor liquida no Postgres, o onboarding grava o
 * handle), mas a tela só conhecia o `sessionStorage` — quem fechasse a aba
 * "perdia" tudo que o banco nunca perdeu. O contrato é o `api.state()` que o
 * cliente já tinha do v0 (CONTEXT §8).
 *
 * Sem `userId` em lugar nenhum: a identidade é o DID verificado do Bearer
 * (CONTEXT §4). O modo demo (§5.1) não passa por aqui — a conta de teste é
 * local e não pode depender de rede.
 */

import { NextResponse } from 'next/server';
import { createLeagueRepo, createPredictionRepo, createUserRepo } from '@palpitei/db';
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
    // Find-or-create: esta pode ser a PRIMEIRA rota que um login novo chama.
    const user = await createUserRepo(db).findOrCreateByPrivyDid(did);
    const [aproveitamento, leaguesCount] = await Promise.all([
      createPredictionRepo(db).estatisticas(user.id),
      createLeagueRepo(db).countForUser(user.id),
    ]);

    return NextResponse.json({
      user: {
        privyDid: did,
        nickname: user.handle,
        level: user.level,
        xp: user.xp,
        streak: user.currentStreak,
        favTeam: user.favoriteTeam,
        // null aqui é a regressão E2 visível: entrou e não ganhou carteira
        // Solana. Espelha o /api/login — a resposta não esconde.
        wallet: user.wallet,
        walletSource: user.walletSource,
      },
      leaguesCount,
      isPremium: user.isPremium,
      // O aproveitamento sai da tabela de palpites, que o MOTOR liquida — a
      // tela nunca conta acerto por conta própria (seria a segunda tabela).
      stats: aproveitamento,
    });
  } catch (e) {
    return erroParaResposta(e, 'GET /api/state');
  } finally {
    await db.close?.();
  }
}
