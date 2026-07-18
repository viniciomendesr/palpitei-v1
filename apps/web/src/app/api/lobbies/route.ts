import { NextResponse } from 'next/server';
import { createLobbyRepo, createMatchRepo, createUserRepo } from '@palpitei/db';
import { createDb } from '@/server/db';
import { didVerificado, erroParaResposta } from '@/server/http';
import { parseRoomId } from '@/server/rooms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  const did = await didVerificado(req);
  if (!did) return NextResponse.json({ error: 'entre com sua conta para criar um lobby' }, { status: 401 });

  const body: unknown = await req.json().catch(() => null);
  const roomId = (body as { roomId?: unknown } | null)?.roomId;
  if (typeof roomId !== 'string') return NextResponse.json({ error: 'partida inválida' }, { status: 400 });
  const room = parseRoomId(roomId);
  if (!room) return NextResponse.json({ error: 'partida inválida' }, { status: 400 });

  const db = createDb();
  try {
    const [user, fixture] = await Promise.all([
      createUserRepo(db).findOrCreateByPrivyDid(did),
      createMatchRepo(db).findById(room.fixtureId),
    ]);
    if (!fixture) return NextResponse.json({ error: 'partida não encontrada no cache' }, { status: 404 });
    const lobby = await createLobbyRepo(db).create(user.id, room.fixtureId, room.training);
    return NextResponse.json({
      ok: true,
      lobby: {
        inviteCode: lobby.inviteCode,
        roomId,
        training: lobby.treino,
        teamA: fixture.p1,
        teamB: fixture.p2,
        memberCount: lobby.memberCount,
        maxPlayers: lobby.maxPlayers,
      },
    }, { status: 201 });
  } catch (error) {
    return erroParaResposta(error, 'POST /api/lobbies');
  } finally {
    await db.close?.();
  }
}
