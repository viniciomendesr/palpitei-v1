import { NextResponse } from 'next/server';
import { createLobbyRepo, createMatchRepo, createUserRepo } from '@palpitei/db';
import { createDb } from '@/server/db';
import { didVerificado, erroParaResposta } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function roomIdOf(fixtureId: number, treino: boolean): string {
  return treino ? `treino-${fixtureId}` : String(fixtureId);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<NextResponse> {
  const db = createDb();
  try {
    const lobby = await createLobbyRepo(db).findByCode((await params).code);
    if (!lobby || lobby.expiresAt <= Date.now() || lobby.phase !== 'waiting') {
      return NextResponse.json({ error: 'esse convite não está mais disponível' }, { status: 404 });
    }
    const fixture = await createMatchRepo(db).findById(lobby.fixtureId);
    if (!fixture) return NextResponse.json({ error: 'partida não encontrada' }, { status: 404 });
    return NextResponse.json({
      lobby: {
        inviteCode: lobby.inviteCode,
        roomId: roomIdOf(lobby.fixtureId, lobby.treino),
        treino: lobby.treino,
        teamA: fixture.p1,
        teamB: fixture.p2,
        memberCount: lobby.memberCount,
        maxPlayers: lobby.maxPlayers,
      },
    });
  } catch (error) {
    return erroParaResposta(error, 'GET /api/lobbies/:code');
  } finally {
    await db.close?.();
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<NextResponse> {
  const did = await didVerificado(req);
  if (!did) return NextResponse.json({ error: 'entre com sua conta para participar' }, { status: 401 });
  const db = createDb();
  try {
    const user = await createUserRepo(db).findOrCreateByPrivyDid(did);
    const lobby = await createLobbyRepo(db).joinByCode(user.id, (await params).code);
    return NextResponse.json({
      ok: true,
      lobby: {
        inviteCode: lobby.inviteCode,
        roomId: roomIdOf(lobby.fixtureId, lobby.treino),
      },
    });
  } catch (error) {
    return erroParaResposta(error, 'POST /api/lobbies/:code');
  } finally {
    await db.close?.();
  }
}
