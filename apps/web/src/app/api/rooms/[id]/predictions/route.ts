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
import { createDb, createUserRepo } from '@palpitei/db';
import { abrirSala, palpitar } from '@/server/rooms';
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

  const fixtureId = Number((await params).id);
  const body: unknown = await req.json().catch(() => null);
  const questionId = (body as { questionId?: unknown } | null)?.questionId;
  // `optionId` é o nome do contrato herdado (PredictionRequest em lib/api.ts).
  // O motor chama de `choice`; quem se ajusta é a rota, não o contrato.
  const optionId = (body as { optionId?: unknown } | null)?.optionId;
  if (typeof questionId !== 'string' || typeof optionId !== 'string') {
    return NextResponse.json({ error: 'questionId e optionId são obrigatórios' }, { status: 400 });
  }

  const sala = await abrirSala(fixtureId);
  if (!sala) {
    return NextResponse.json({ error: 'sala não está aberta' }, { status: 404 });
  }

  const db = createDb();
  try {
    // Find-or-create pelo DID: a identidade é o DID, nunca a carteira (a
    // carteira muda, e o MESMO endereço aparece duas vezes depois do export).
    const user = await createUserRepo(db).findOrCreateByPrivyDid(did);
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
