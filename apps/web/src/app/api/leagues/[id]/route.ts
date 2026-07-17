/**
 * GET /api/leagues/:id — a liga por dentro: quem está nela e o código do convite.
 *
 * A liga é PRIVADA. Quem não é membro recebe 404 — o MESMO 404 de uma liga que
 * não existe, de propósito: um 403 aqui contaria que a liga existe para quem só
 * tem o id, e id vaza (histórico, log de proxy, print no grupo). O convite é a
 * porta; não há outra.
 */

import { NextResponse } from 'next/server';
import { createLeagueRepo, createUserRepo } from '@palpitei/db';
import { createDb } from '@/server/db';
import { didVerificado, erroParaResposta } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const did = await didVerificado(req);
  if (!did) {
    return NextResponse.json(
      { error: 'sem sessão verificada — o modo demo não usa esta rota' },
      { status: 401 },
    );
  }

  const { id } = await params;

  const db = createDb();
  try {
    const user = await createUserRepo(db).findOrCreateByPrivyDid(did);
    const ligas = createLeagueRepo(db);

    // Uma consulta só comprova acesso e lê a liga. Sem associação, não revela
    // se o id existe.
    const liga = await ligas.findForMember(id, user.id);
    if (!liga) return NextResponse.json({ error: 'essa liga não existe' }, { status: 404 });

    const membros = await ligas.listMembers(id);
    return NextResponse.json({
      league: {
        id: liga.id,
        name: liga.name,
        memberCount: liga.memberCount,
        inviteCode: liga.inviteCode,
        iLead: liga.ownerId === user.id,
      },
      members: membros.map((m) => ({
        // `handle` null = o fã ainda não escolheu apelido. A tela mostra "sem
        // apelido"; NUNCA um nome inventado, e nunca o e-mail (E12).
        handle: m.handle,
        iLead: m.role === 'owner',
        me: m.userId === user.id,
      })),
    });
  } catch (e) {
    return erroParaResposta(e, 'GET /api/leagues/:id');
  } finally {
    await db.close?.();
  }
}
