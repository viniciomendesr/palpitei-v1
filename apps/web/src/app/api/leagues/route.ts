/**
 * GET  /api/leagues — as ligas do fã (as que ele criou e as que entrou).
 * POST /api/leagues — cria uma liga. Corpo: `{ name }`.
 *
 * NÃO existe `userId` em lugar nenhum daqui, e não é esquecimento: a identidade
 * é o DID verificado do Bearer (CONTEXT §4). Quem manda o nome da liga é o fã;
 * quem diz quem ele é é a Privy.
 *
 * O modo demo (§5.1) não passa por aqui: a liga do jurado é mock local, sem
 * rede. É o caminho ensaiado e ele não pode depender de nada.
 */

import { NextResponse } from 'next/server';
import { createDb, createLeagueRepo, createUserRepo, LIGAS_FREE } from '@palpitei/db';
import { didVerificado, erroParaResposta } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const did = await didVerificado(req);
  if (!did) {
    return NextResponse.json(
      { error: 'sem sessão verificada — o modo demo não usa esta rota' },
      { status: 401 },
    );
  }

  const db = createDb();
  try {
    const user = await createUserRepo(db).findOrCreateByPrivyDid(did);
    const ligas = createLeagueRepo(db);
    const [minhas, criadas] = await Promise.all([
      ligas.listForUser(user.id),
      ligas.countOwned(user.id),
    ]);

    return NextResponse.json({
      leagues: minhas.map((l) => ({
        id: l.id,
        name: l.name,
        // O número vem do banco. O "1 membro" da tela era string fixa do
        // dicionário — é justamente o que este campo aposenta.
        memberCount: l.memberCount,
        iLead: l.iLead,
        inviteCode: l.inviteCode,
      })),
      // Só as ligas CRIADAS contam para a cota. Entrar na liga de um amigo não
      // gasta o free — senão o primeiro convidado não conseguiria aceitar.
      ownedCount: criadas,
      freeLimit: LIGAS_FREE,
      isPremium: user.isPremium,
    });
  } catch (e) {
    return erroParaResposta(e, 'GET /api/leagues');
  } finally {
    await db.close?.();
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  // Autentica ANTES de ler o corpo: quem não tem sessão não descobre nem que
  // este endpoint valida nome.
  const did = await didVerificado(req);
  if (!did) {
    return NextResponse.json(
      { error: 'sem sessão verificada — o modo demo não usa esta rota' },
      { status: 401 },
    );
  }

  const body: unknown = await req.json().catch(() => null);
  const name = (body as { name?: unknown } | null)?.name;
  if (typeof name !== 'string') {
    return NextResponse.json({ error: 'dá um nome pra sua liga' }, { status: 400 });
  }

  const db = createDb();
  try {
    const user = await createUserRepo(db).findOrCreateByPrivyDid(did);
    // O gate do free vive DENTRO do repo, sob trava da linha do fã — não num
    // `if` aqui. A tela também checa, mas só para não levar o fã a um erro
    // evitável; a regra é do banco.
    const liga = await createLeagueRepo(db).create(user.id, name);
    return NextResponse.json({ ok: true, league: { ...liga, iLead: true } }, { status: 201 });
  } catch (e) {
    // LeagueLimitError vira 402 aqui — o paywall, não um silêncio.
    return erroParaResposta(e, 'POST /api/leagues');
  } finally {
    await db.close?.();
  }
}
