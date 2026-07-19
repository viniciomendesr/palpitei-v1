
import { NextResponse } from 'next/server';
import { PrivyClient } from '@privy-io/server-auth';
import { createLobbyRepo, createUserRepo } from '@palpitei/db';
import { createDb } from '@/server/db';
import { getLobby } from '@/server/lobbies';
import { canAccessStartedLobby, inMemoryLobbyAllowsRoom } from '@/server/lobby-acesso';
import { openRoom, roomKey, placePrediction, parsePartyId, parseRoomId } from '@/server/rooms';
import { toCoreUser } from '@/server/identidade';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '';
const APP_SECRET = process.env.PRIVY_APP_SECRET ?? '';

async function didVerificado(req: Request): Promise<string | null> {
  const header = req.headers.get('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token || !APP_ID || !APP_SECRET) return null;
  try {
    const { userId } = await new PrivyClient(APP_ID, APP_SECRET).verifyAuthToken(token);
    return userId ?? null;
  } catch {
    return null;
  }
}

export async function POST(
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

  const roomId = parseRoomId((await params).id);
  if (!roomId) {
    return NextResponse.json({ error: 'sala inválida' }, { status: 400 });
  }
  const partyId = parsePartyId(new URL(req.url).searchParams.get('party'));
  if (!partyId) {
    return NextResponse.json({ error: 'código do grupo inválido' }, { status: 400 });
  }
  const body: unknown = await req.json().catch(() => null);
  const questionId = (body as { questionId?: unknown } | null)?.questionId;
  const optionId = (body as { optionId?: unknown } | null)?.optionId;
  if (typeof questionId !== 'string' || typeof optionId !== 'string') {
    return NextResponse.json({ error: 'questionId e optionId são obrigatórios' }, { status: 400 });
  }

  const db = createDb();
  try {
    const user = await createUserRepo(db).findByPrivyDid(did);
    if (!user) return NextResponse.json({ error: 'você não participa desse lobby' }, { status: 403 });
    const persistent = await createLobbyRepo(db).findForMember(partyId, user.id);
    if (!canAccessStartedLobby(persistent, roomId)) {
      return NextResponse.json({ error: 'você não participa desse lobby' }, { status: 403 });
    }

    const lobby = getLobby(roomKey(roomId.fixtureId, roomId.training, partyId));
    // A finished lobby still opens the room; the engine rejects any question
    // that is not `open`, so reading the result cannot become a late prediction.
    if (!inMemoryLobbyAllowsRoom(lobby?.phase)) {
      return NextResponse.json({ error: 'a partida ainda não começou no lobby' }, { status: 409 });
    }
    const sala = await openRoom(roomId.fixtureId, roomId.training, partyId);
    if (!sala) return NextResponse.json({ error: 'sala não está aberta' }, { status: 404 });

    const r = await placePrediction(sala, toCoreUser(user), questionId, optionId);
    return NextResponse.json(r, { status: r.ok ? 200 : 409 });
  } catch (e) {
    console.error('[palpitei] palpite falhou:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'não deu para registrar o palpite' }, { status: 500 });
  } finally {
    await db.close?.();
  }
}
