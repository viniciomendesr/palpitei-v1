/** Lobby sincronizado por SSE. O runner só nasce depois do `start` do host. */

import { createLobbyRepo, createMatchRepo, createUserRepo } from '@palpitei/db';
import { createDb } from '@/server/db';
import { didVerificado } from '@/server/http';
import { PULSO, iniciarPulso } from '@/server/pulso';
import { consumirTicketSse } from '@/server/sse-ticket';
import {
  connectLobby,
  finishLobby,
  getLobby,
  leaveLobby,
  openLobby,
  setReady,
  startLobby,
} from '@/server/lobbies';
import { chaveDaSala, parsePartyId, parseRoomId } from '@/server/rooms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ContextoErro = { error: string; status: number };
type ContextoBase = {
  rawRoomId: string;
  room: { fixtureId: number; treino: boolean };
  partyId: string;
};
type ContextoAutenticado = ContextoBase & { did: string };

function temErro<T extends object>(ctx: T | ContextoErro): ctx is ContextoErro {
  return 'error' in ctx;
}

async function contextoBase(
  req: Request,
  params: Promise<{ id: string }>,
): Promise<ContextoBase | ContextoErro> {
  const rawRoomId = (await params).id;
  const room = parseRoomId(rawRoomId);
  const partyId = parsePartyId(new URL(req.url).searchParams.get('party'));
  if (!room || !partyId) return { error: 'sala ou grupo inválido', status: 400 };
  return { rawRoomId, room, partyId };
}

async function contextoComBearer(
  req: Request,
  params: Promise<{ id: string }>,
): Promise<ContextoAutenticado | ContextoErro> {
  const did = await didVerificado(req);
  if (!did) return { error: 'sem sessão verificada', status: 401 };
  const base = await contextoBase(req, params);
  return temErro(base) ? base : { ...base, did };
}

async function contextoComTicket(
  req: Request,
  params: Promise<{ id: string }>,
): Promise<ContextoAutenticado | ContextoErro> {
  const base = await contextoBase(req, params);
  if (temErro(base)) return base;
  const did = consumirTicketSse(new URL(req.url).searchParams.get('ticket'), {
    purpose: 'lobby',
    roomId: base.rawRoomId,
    partyId: base.partyId,
  });
  if (!did) return { error: 'sem sessão verificada', status: 401 };
  return { ...base, did };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const ctx = await contextoComTicket(req, params);
  if (temErro(ctx)) return Response.json({ error: ctx.error }, { status: ctx.status });

  const db = createDb();
  try {
    const [fixture, user] = await Promise.all([
      createMatchRepo(db).findById(ctx.room.fixtureId),
      createUserRepo(db).findOrCreateByPrivyDid(ctx.did),
    ]);
    if (!fixture) return Response.json({ error: 'partida não encontrada no cache' }, { status: 404 });
    const persistent = await createLobbyRepo(db).findForMember(ctx.partyId, user.id);
    if (
      !persistent ||
      persistent.fixtureId !== ctx.room.fixtureId ||
      persistent.treino !== ctx.room.treino ||
      persistent.expiresAt <= Date.now() ||
      !['waiting', 'started', 'finished'].includes(persistent.phase)
    ) {
      return Response.json({ error: 'você não participa desse lobby' }, { status: 403 });
    }

    const lobby = openLobby({
      key: chaveDaSala(ctx.room.fixtureId, ctx.room.treino, ctx.partyId),
      roomId: ctx.rawRoomId,
      partyId: ctx.partyId,
      fixtureId: ctx.room.fixtureId,
      treino: ctx.room.treino,
      teamA: fixture.p1,
      teamB: fixture.p2,
      hostId: persistent.hostUserId,
      phase: persistent.phase === 'finished'
        ? 'finished'
        : persistent.phase === 'started'
          ? 'started'
          : 'waiting',
    });
    const enc = new TextEncoder();
    let disconnect = () => {};
    let stopPulse = () => {};
    const stream = new ReadableStream({
      start(controller) {
        const send = (state: unknown) => {
          try {
            controller.enqueue(enc.encode(`data: ${JSON.stringify(state)}\n\n`));
          } catch {
            // conexão encerrada
          }
        };
        disconnect = connectLobby(
          lobby,
          { id: user.id, name: user.handle ?? 'sem apelido' },
          send,
        );
        stopPulse = iniciarPulso(() => controller.enqueue(enc.encode(PULSO)));
        req.signal.addEventListener('abort', () => {
          stopPulse();
          disconnect();
          try {
            controller.close();
          } catch {
            // já fechada
          }
        });
      },
      cancel() {
        stopPulse();
        disconnect();
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
  } finally {
    await db.close?.();
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const ctx = await contextoComBearer(req, params);
  if (temErro(ctx)) return Response.json({ error: ctx.error }, { status: ctx.status });
  const body = (await req.json().catch(() => null)) as
    | { action?: unknown; ready?: unknown }
    | null;
  const lobby = getLobby(chaveDaSala(ctx.room.fixtureId, ctx.room.treino, ctx.partyId));
  if (!lobby) return Response.json({ error: 'lobby não está aberto' }, { status: 404 });

  const db = createDb();
  try {
    const user = await createUserRepo(db).findOrCreateByPrivyDid(ctx.did);
    const persistent = await createLobbyRepo(db).findForMember(ctx.partyId, user.id);
    if (
      !persistent ||
      persistent.fixtureId !== ctx.room.fixtureId ||
      persistent.treino !== ctx.room.treino
    ) {
      return Response.json({ error: 'você não participa desse lobby' }, { status: 403 });
    }
    if (body?.action === 'ready' && typeof body.ready === 'boolean') {
      return setReady(lobby, user.id, body.ready)
        ? Response.json({ ok: true })
        : Response.json({ error: 'você não está neste lobby' }, { status: 409 });
    }
    if (body?.action === 'start') {
      const result = startLobby(lobby, user.id);
      if (!result.ok) return Response.json({ error: result.error }, { status: 409 });
      await createLobbyRepo(db).markStarted(ctx.partyId, user.id);
      return Response.json({ ok: true });
    }
    if (body?.action === 'leave') {
      await createLobbyRepo(db).markLeft(ctx.partyId, user.id);
      leaveLobby(lobby, user.id);
      return Response.json({ ok: true });
    }
    if (body?.action === 'finish') {
      await createLobbyRepo(db).markFinished(ctx.partyId, user.id);
      finishLobby(lobby);
      return Response.json({ ok: true });
    }
    return Response.json({ error: 'ação inválida' }, { status: 400 });
  } finally {
    await db.close?.();
  }
}
