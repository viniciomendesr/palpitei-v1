/**
 * POST /api/rooms/:id/predictions — o palpite. Exige login.
 *
 * O corpo é `{ questionId, choice }` e NADA MAIS. Não existe `userId` aqui, e
 * não é esquecimento: a identidade é o DID verificado do Bearer (CONTEXT §4).
 * O v0 tinha um resolveUser() que caía para body.userId sem header — atrás de
 * link público com ranking valendo, isso é fraude de um curl.
 *
 * Quem decide se o palpite vale é o MOTOR, com o relógio da sala: a janela
 * fecha ANTES do evento que resolve, e a tela não opina. Se a janela fechou, o
 * fã ouve "janela fechada" — não um XP que não ganhou.
 */

import { NextResponse } from 'next/server';
import { PrivyClient } from '@privy-io/server-auth';
import { createLobbyRepo, createUserRepo } from '@palpitei/db';
import { createDb } from '@/server/db';
import { getLobby } from '@/server/lobbies';
import { podeAcessarLobbyIniciado } from '@/server/lobby-acesso';
import { abrirSala, chaveDaSala, palpitar, parsePartyId, parseRoomId } from '@/server/rooms';
import { paraCore } from '@/server/identidade';

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

  // `treino-18241006` é a MESMA partida sem XP — a regra de parse é uma só
  // (parseRoomId), senão stream e palpite abririam salas diferentes do mesmo id.
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
  // `optionId` é o nome do contrato herdado (PredictionRequest em lib/api.ts).
  // O motor chama de `choice`; quem se ajusta é a rota, não o contrato.
  const optionId = (body as { optionId?: unknown } | null)?.optionId;
  if (typeof questionId !== 'string' || typeof optionId !== 'string') {
    return NextResponse.json({ error: 'questionId e optionId são obrigatórios' }, { status: 400 });
  }

  const db = createDb();
  try {
    // Só a associação PERSISTIDA autoriza. O Map do lobby é presença efêmera;
    // usá-lo sozinho deixava um ex-membro (ou quem só conhece o código) ganhar
    // XP ao postar diretamente nesta rota.
    const user = await createUserRepo(db).findByPrivyDid(did);
    if (!user) return NextResponse.json({ error: 'você não participa desse lobby' }, { status: 403 });
    const persistent = await createLobbyRepo(db).findForMember(partyId, user.id);
    if (!podeAcessarLobbyIniciado(persistent, roomId)) {
      return NextResponse.json({ error: 'você não participa desse lobby' }, { status: 403 });
    }

    // Depois da autorização persistida, a instância em memória só decide se o
    // processo já abriu o runner desta partida.
    const lobby = getLobby(chaveDaSala(roomId.fixtureId, roomId.treino, partyId));
    if (!lobby || lobby.phase !== 'started') {
      return NextResponse.json({ error: 'a partida ainda não começou no lobby' }, { status: 409 });
    }
    const sala = await abrirSala(roomId.fixtureId, roomId.treino, partyId);
    if (!sala) return NextResponse.json({ error: 'sala não está aberta' }, { status: 404 });

    // paraCore estoura se o fã não tem carteira Solana (E2). Não coage NULL.
    const r = await palpitar(sala, paraCore(user), questionId, optionId);
    // 409: a pergunta existe, o palpite é que não vale (janela fechada, repetido).
    return NextResponse.json(r, { status: r.ok ? 200 : 409 });
  } catch (e) {
    // O flush estoura aqui quando o banco recusou a escrita. É o que impede o
    // "palpite registrado" mentiroso: o fã recebe erro de verdade.
    console.error('[palpitei] palpite falhou:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'não deu para registrar o palpite' }, { status: 500 });
  } finally {
    await db.close?.();
  }
}
