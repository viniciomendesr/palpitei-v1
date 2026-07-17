/**
 * POST /api/account/team — o time do coração. Exige login.
 *
 * O corpo é `{ team }` e NADA MAIS — `null` limpa (o passo é pulável e "pulei"
 * não pode virar um time inventado). Sem `userId`: a identidade é o DID
 * verificado do Bearer (CONTEXT §4).
 *
 * Existia `setFavoriteTeam` no repo desde o schema e NENHUMA rota o chamava: o
 * onboarding pintava o escudo na tela e o banco ficava NULL — a escolha morria
 * com a aba, como o apelido antes desta leva de correções.
 */

import { NextResponse } from 'next/server';
import { createUserRepo } from '@palpitei/db';
import { createDb } from '@/server/db';
import { didVerificado, erroParaResposta } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TEAM = 40;

export async function POST(req: Request): Promise<NextResponse> {
  const did = await didVerificado(req);
  if (!did) {
    return NextResponse.json(
      { error: 'sem sessão verificada — o modo demo não usa esta rota' },
      { status: 401 },
    );
  }

  const body: unknown = await req.json().catch(() => null);
  const team = (body as { team?: unknown } | null)?.team;
  if (team !== null && typeof team !== 'string') {
    return NextResponse.json({ error: 'time inválido' }, { status: 400 });
  }
  const limpo = typeof team === 'string' ? team.trim() : null;
  if (limpo !== null && (!limpo.length || limpo.length > MAX_TEAM)) {
    return NextResponse.json({ error: 'time inválido' }, { status: 400 });
  }

  const db = createDb();
  try {
    const repo = createUserRepo(db);
    const user = await repo.findOrCreateByPrivyDid(did);
    const salvo = await repo.setFavoriteTeam(user.id, limpo);
    return NextResponse.json({ ok: true, favTeam: salvo.favoriteTeam });
  } catch (e) {
    return erroParaResposta(e, 'POST /api/account/team');
  } finally {
    await db.close?.();
  }
}
