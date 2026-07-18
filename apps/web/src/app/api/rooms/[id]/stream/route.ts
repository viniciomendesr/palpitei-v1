
import { createLobbyRepo, createUserRepo } from '@palpitei/db';
import { createDb } from '@/server/db';
import { getLobby } from '@/server/lobbies';
import { canAccessStartedLobby } from '@/server/lobby-acesso';
import { PULSO, iniciarPulso } from '@/server/pulso';
import { consumirTicketSse } from '@/server/sse-ticket';
import {
  openRoom,
  subscribe,
  roomKey,
  roomStateFor,
  parsePartyId,
  parseRoomId,
  roomRanking,
  registerHandle,
} from '@/server/rooms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const rawRoomId = (await params).id;
  const roomId = parseRoomId(rawRoomId);
  if (!roomId) {
    return Response.json({ error: 'sala inválida' }, { status: 400 });
  }

  const partyId = parsePartyId(new URL(req.url).searchParams.get('party'));
  if (!partyId) {
    return Response.json({ error: 'código do grupo inválido' }, { status: 400 });
  }
  const did = consumirTicketSse(new URL(req.url).searchParams.get('ticket'), {
    purpose: 'room',
    roomId: rawRoomId,
    partyId,
  });
  if (!did) {
    return Response.json(
      { error: 'sem sessão verificada — o modo demo não usa esta rota' },
      { status: 401 },
    );
  }
  const dbUser = createDb();
  let userId: string;
  let userHandle: string | null;
  try {
    const user = await createUserRepo(dbUser).findByPrivyDid(did);
    if (!user) return Response.json({ error: 'você não participa desse lobby' }, { status: 403 });
    const persistent = await createLobbyRepo(dbUser).findForMember(partyId, user.id);
    if (!canAccessStartedLobby(persistent, roomId)) {
      return Response.json({ error: 'você não participa desse lobby' }, { status: 403 });
    }
    userId = user.id;
    userHandle = user.handle;
  } catch (e) {
    console.error('[palpitei] autorização do stream falhou:', e instanceof Error ? e.message : e);
    return Response.json({ error: 'não deu para verificar seu acesso ao lobby' }, { status: 500 });
  } finally {
    await dbUser.close?.();
  }

  const lobby = getLobby(roomKey(roomId.fixtureId, roomId.training, partyId));
  if (!lobby || lobby.phase !== 'started') {
    return Response.json({ error: 'a partida ainda não começou no lobby' }, { status: 409 });
  }
  const sala = await openRoom(roomId.fixtureId, roomId.training, partyId);
  if (!sala) return Response.json({ error: 'partida não encontrada no cache' }, { status: 404 });

  registerHandle(sala, userId, userHandle);

  const enc = new TextEncoder();
  let desassinar = () => {};
  let pararPulso = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const mandar = (msg: unknown) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(msg)}\n\n`));
        } catch {
        }
      };

      mandar(roomStateFor(sala, userId));
      mandar(roomRanking(sala, userId));
      desassinar = subscribe(sala, { userId, enviar: mandar });

      pararPulso = iniciarPulso(() => controller.enqueue(enc.encode(PULSO)));

      req.signal.addEventListener('abort', () => {
        pararPulso();
        desassinar();
        try {
          controller.close();
        } catch {
        }
      });
    },
    cancel() {
      pararPulso();
      desassinar();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
