/**
 * POST /api/login — Bearer da Privy → find-or-create por DID. Corpo vazio.
 *
 * É o contrato do CONTEXT §8, e a primeira linha de defesa do §4: a identidade é
 * o DID VERIFICADO do token, nunca `body.userId`. O corpo é `{}` de propósito —
 * não há nada que o cliente possa dizer sobre quem ele é que valha alguma coisa.
 *
 * ─── por que a carteira também não vem do cliente ───
 *
 * `findOrCreateByPrivyDid` aceita `{ wallet, walletSource }`, e é tentador
 * mandar do browser: a ilha já tem `privy.wallets`. Seria o mesmo furo do
 * body.userId, com outro nome — atrás de link público, um curl reivindicaria a
 * carteira de qualquer um. Aqui a carteira sai de `PrivyClient.getUser(did)`, no
 * servidor, das linked accounts que a Privy confirma.
 *
 * A identidade é o DID, NUNCA a carteira (decisão nº 3 do CONTEXT): a carteira
 * muda (a Opção B depois ganha embutida) e o MESMO endereço aparece duas vezes
 * quando o fã exporta a chave e conecta no Phantom (E16).
 */

import { NextResponse } from 'next/server';
import { PrivyClient } from '@privy-io/server-auth';
import { createUserRepo } from '@palpitei/db';
import { createDb } from '@/server/db';
import { carteiraSolana } from '@/server/identidade';

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
    // As linked accounts vêm da Privy, no servidor. É a única fonte que o fã
    // não escreve.
    const conta = await privy.getUser(did);
    const carteira = carteiraSolana(
      (conta.linkedAccounts ?? []) as Parameters<typeof carteiraSolana>[0],
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
        // null aqui é a regressão E2 visível: entrou e não ganhou carteira
        // Solana. O schema recusa a esconder, e a resposta também.
        wallet: user.wallet,
        walletSource: user.walletSource,
      },
    });
  } catch (e) {
    console.error('[palpitei] /api/login falhou:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'não deu para entrar agora' }, { status: 500 });
  } finally {
    await db.close?.();
  }
}
