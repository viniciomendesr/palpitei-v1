
import { NextResponse } from 'next/server';
import { PrivyClient } from '@privy-io/server-auth';
import { createUserRepo } from '@palpitei/db';
import { createDb } from '@/server/db';
import { findSolanaWallet } from '@/server/identidade';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '';
const APP_SECRET = process.env.PRIVY_APP_SECRET ?? '';

export async function POST(req: Request): Promise<NextResponse> {
  const header = req.headers.get('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token || !APP_ID || !APP_SECRET) {
    return NextResponse.json({ error: 'sem sessão verificada' }, { status: 401 });
  }

  const privy = new PrivyClient(APP_ID, APP_SECRET);

  let did: string;
  try {
    const { userId } = await privy.verifyAuthToken(token);
    did = userId;
  } catch {
    return NextResponse.json({ error: 'sem sessão verificada' }, { status: 401 });
  }

  const db = createDb();
  try {
    const conta = await privy.getUser(did);
    const carteira = findSolanaWallet(
      (conta.linkedAccounts ?? []) as Parameters<typeof findSolanaWallet>[0],
    );

    const user = await createUserRepo(db).findOrCreateByPrivyDid(did, {
      wallet: carteira?.wallet ?? null,
      walletSource: carteira?.walletSource ?? null,
    });

    return NextResponse.json({
      ok: true,
      user: {
        privyDid: did,
        nickname: user.handle,
        level: user.level,
        xp: user.xp,
        streak: user.currentStreak,
        wallet: user.wallet,
        walletSource: user.walletSource,
      },
    });
  } catch (e) {
    console.error('[palpitei] /api/login failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'não deu para entrar agora' }, { status: 500 });
  } finally {
    await db.close?.();
  }
}
