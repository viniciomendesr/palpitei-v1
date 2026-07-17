/**
 * POST /api/account/handle — o fã escolhe o apelido. Exige login.
 *
 * O corpo é `{ nickname }` e NADA MAIS. Não existe `userId` aqui, e não é
 * esquecimento: a identidade é o DID verificado do Bearer (CONTEXT §4). Aceitar
 * um userId do cliente seria deixar qualquer curl renomear a conta alheia — e o
 * apelido é o nome que aparece no ranking de todo mundo.
 *
 * ─── por que o apelido chega do FORMULÁRIO e nunca do e-mail ───
 *
 * A Privy tem o e-mail do fã, e derivar `joao.silva@gmail.com` → "joao.silva"
 * seria uma linha. É o achado E12: o apelido é PÚBLICO (ranking, ligas), então
 * derivá-lo publica o endereço da pessoa para a sala inteira. Por isso o
 * onboarding pergunta, por isso o campo nasce vazio, e por isso esta rota só
 * conhece o que o fã digitou. Nada neste arquivo lê e-mail.
 *
 * Quem valida e quem resolve a corrida de apelido repetido é o repo: o UNIQUE do
 * banco decide, não um SELECT antes do UPDATE (que perde a corrida em silêncio e
 * cria dois "craques"). Aqui só se traduz erro de domínio em status HTTP.
 */

import { NextResponse } from 'next/server';
import { PrivyClient } from '@privy-io/server-auth';
import {
  createDb,
  createUserRepo,
  HandleInvalidError,
  HandleTakenError,
  UserNotFoundError,
} from '@palpitei/db';

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

export async function POST(req: Request): Promise<NextResponse> {
  const did = await didVerificado(req);
  if (!did) {
    return NextResponse.json(
      { error: 'sem sessão verificada — o modo demo não usa esta rota' },
      { status: 401 },
    );
  }

  const body: unknown = await req.json().catch(() => null);
  const nickname = (body as { nickname?: unknown } | null)?.nickname;
  if (typeof nickname !== 'string') {
    return NextResponse.json({ error: 'nickname é obrigatório' }, { status: 400 });
  }

  const db = createDb();
  try {
    // Find-or-create pelo DID: o fã pode estar escolhendo o apelido antes de
    // qualquer outra rota ter criado a linha dele. A identidade é o DID.
    const user = await createUserRepo(db).findOrCreateByPrivyDid(did);
    const salvo = await createUserRepo(db).setHandle(user.id, nickname);

    return NextResponse.json({
      ok: true,
      user: {
        privyDid: did,
        nickname: salvo.handle,
        level: salvo.level,
        xp: salvo.xp,
        streak: salvo.currentStreak,
        // null aqui é a regressão E2 visível: entrou e não ganhou carteira
        // Solana. Espelha o /api/login — a resposta não esconde.
        wallet: salvo.wallet,
        walletSource: salvo.walletSource,
      },
    });
  } catch (e) {
    // Os erros de domínio já vêm com mensagem de fã, em pt-BR e sem culpar
    // ninguém. Repetir a mensagem aqui criaria uma segunda verdade.
    if (e instanceof HandleTakenError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof HandleInvalidError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof UserNotFoundError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error('[palpitei] /api/account/handle falhou:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'não deu para salvar o apelido agora' }, { status: 500 });
  } finally {
    await db.close?.();
  }
}
