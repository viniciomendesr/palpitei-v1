/**
 * POST /api/leagues/join — entra numa liga pelo código do convite. Corpo: `{ code }`.
 *
 * É o outro lado do "chame a galera": sem isto, criar liga privada seria criar
 * um grupo de uma pessoa só.
 *
 * ENTRAR NÃO GASTA A COTA DO FREE (a cota é sobre a liga que você CRIA). Se
 * gastasse, o primeiro amigo que você chamasse — que provavelmente já tem a
 * própria liga — não conseguiria aceitar o convite.
 */

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
    // Código que não abre liga nenhuma vira 404 com mensagem de gente — não um
    // 200 mudo que deixaria o fã achando que entrou.
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
