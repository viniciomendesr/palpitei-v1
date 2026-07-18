/** Emite um ticket curto e de uso único para abrir um SSE autenticado. */

import { didVerificado } from '@/server/http';
import { ehFinalidadeTicketSse, emitirTicketSse } from '@/server/sse-ticket';
import { parsePartyId, parseRoomId } from '@/server/rooms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const did = await didVerificado(req);
  if (!did) return Response.json({ error: 'sem sessão verificada' }, { status: 401 });

  const roomId = (await params).id;
  const room = parseRoomId(roomId);
  const partyId = parsePartyId(new URL(req.url).searchParams.get('party'));
  const body = (await req.json().catch(() => null)) as { purpose?: unknown } | null;
  if (!room || !partyId || !ehFinalidadeTicketSse(body?.purpose)) {
    return Response.json({ error: 'sala, grupo ou finalidade inválidos' }, { status: 400 });
  }

  // A filiação continua sendo validada no stream antes de qualquer estado da
  // sala/lobby; este ticket só transporta a identidade verificada até lá.
  return Response.json({
    ticket: emitirTicketSse({ did, purpose: body.purpose, roomId, partyId }),
  });
}
