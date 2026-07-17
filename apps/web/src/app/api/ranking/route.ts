/**
 * GET /api/ranking — o ranking global (a temporada), por XP. Exige login.
 *
 * Antes desta rota a tela de ranking mostrava `globalRanking()` do mock —
 * Dudu_10, MarianaGols — para o fã LOGADO, com cara de temporada real. É a
 * regra 4 do CLAUDE.md na letra: fã logado vê erro, nunca mock com cara de
 * real. O `topByXp` existia no repo desde o schema; faltava quem o chamasse.
 *
 * Só entra quem tem apelido (o SELECT filtra `handle is not null`): apelido é o
 * nome público, e listar alguém como "sem apelido" num ranking global é ruído.
 * A ÚNICA exceção é a linha do próprio fã (`me`), fora do top: ele precisa se
 * achar mesmo sem estar na lista — com `pos: null`, porque calcular a posição
 * exata de quem está fora do corte é uma query que esta tela não paga hoje.
 */

import { NextResponse } from 'next/server';
import { createDb, createUserRepo } from '@palpitei/db';
import { didVerificado, erroParaResposta } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TOP = 50;

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
    const repo = createUserRepo(db);
    const eu = await repo.findOrCreateByPrivyDid(did);
    const top = await repo.topByXp(TOP);

    // O userId interno NÃO atravessa (mesma regra do ranking da sala): o
    // browser só precisa de apelido, XP, nível — e de saber qual linha é a dele.
    type Linha = { pos: number | null; name: string; xp: number; level: number; me: boolean };
    const rows: Linha[] = top.map((r, i) => ({
      pos: i + 1,
      name: r.handle,
      xp: r.xp,
      level: r.level,
      me: r.userId === eu.id,
    }));

    if (!rows.some((r) => r.me)) {
      rows.push({ pos: null, name: eu.handle ?? '', xp: eu.xp, level: eu.level, me: true });
    }

    return NextResponse.json({ rows });
  } catch (e) {
    return erroParaResposta(e, 'GET /api/ranking');
  } finally {
    await db.close?.();
  }
}
