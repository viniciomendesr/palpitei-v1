
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

export async function DELETE(
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

    await createLeagueRepo(db).delete(id, user.id);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return erroParaResposta(e, 'DELETE /api/leagues/:id');
  } finally {
    await db.close?.();
  }
}
