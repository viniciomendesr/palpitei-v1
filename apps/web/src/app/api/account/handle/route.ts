
import { NextResponse } from 'next/server';
import { PrivyClient } from '@privy-io/server-auth';
import {
  createUserRepo,
  HandleInvalidError,
  HandleTakenError,
  UserNotFoundError,
} from '@palpitei/db';
import { createDb } from '@/server/db';

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
        wallet: salvo.wallet,
        walletSource: salvo.walletSource,
      },
    });
  } catch (e) {
    if (e instanceof HandleTakenError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof HandleInvalidError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof UserNotFoundError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error('[palpitei] /api/account/handle failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'não deu para salvar o apelido agora' }, { status: 500 });
  } finally {
    await db.close?.();
  }
}
