/**
 * GET    /api/leagues/:id — a liga por dentro: quem está nela e o código do convite.
 * DELETE /api/leagues/:id — o LÍDER apaga a liga; os membros saem junto (FK).
 *
 * A liga é PRIVADA. Quem não é membro recebe 404 — o MESMO 404 de uma liga que
 * não existe, de propósito: um 403 aqui contaria que a liga existe para quem só
 * tem o id, e id vaza (histórico, log de proxy, print no grupo). O convite é a
 * porta; não há outra. No DELETE, o 403 só existe para o MEMBRO que não lidera —
 * esse já vê a liga por dentro, não há existência a esconder.
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

    // A posse é conferida NA QUERY do repo (`owner_id = ?`), com a identidade
    // do Bearer — nunca de um id do cliente. Os erros de domínio já carregam o
    // status certo: 404 para não-membro (o mesmo de liga inexistente) e 403
    // para membro que não lidera.
    await createLeagueRepo(db).delete(id, user.id);

    // A cota do free conta ligas CRIADAS (`countOwned`): a linha sumiu, a cota
    // voltou — não há contador para ajustar em lugar nenhum.
    return NextResponse.json({ ok: true });
  } catch (e) {
    return erroParaResposta(e, 'DELETE /api/leagues/:id');
  } finally {
    await db.close?.();
  }
}
