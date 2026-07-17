/**
 * GET /api/fixtures — as partidas REAIS da TxLINE. Exige login.
 *
 * A divisão é deliberada e é a regra do produto:
 *
 *   modo demo (§5.1)  → mock, client-side. NÃO passa por aqui.
 *   Google / carteira → só dado real da TxLINE, e é o que esta rota serve.
 *
 * Por isso ausência de Bearer é 401, não um fallback silencioso para o mock: um
 * fallback faria a tela do fã logado parecer viva com número inventado, que é
 * exatamente a mentira que a §2 proíbe ("badge de fonte em cada sala") e o G6
 * batizou ("rótulo de proveniência não pode mentir").
 *
 * A identidade é o DID VERIFICADO do token. `body.userId` não existe neste
 * projeto e não é esquecimento (CONTEXT §4): atrás de link público com ranking
 * valendo, aceitar id do cliente é fraude trivial.
 *
 * Duas origens, dois selos:
 *   - agendadas  → /fixtures/snapshot da devnet  → source 'txline'
 *   - retroativa → cache no Postgres             → source = o cache_source gravado
 *     (hoje 'txline-updates': England × Argentina, 962 eventos, 3758 odds)
 */

import { NextResponse } from 'next/server';
import { PrivyClient } from '@privy-io/server-auth';
import { createMatchRepo } from '@palpitei/db';
import { createDb } from '@/server/db';
import { fixturesTxline } from '@/server/fixtures';
import type { ApiFixture } from '@/lib/api';

/** pg e o cliente da TxLINE não rodam no edge; e a resposta muda a cada evento. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '';
const APP_SECRET = process.env.PRIVY_APP_SECRET ?? '';

/** O DID verificado, ou null. Nunca confie em nada que o cliente diga ser. */
async function didVerificado(req: Request): Promise<string | null> {
  const header = req.headers.get('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token || !APP_ID || !APP_SECRET) return null;
  try {
    const { userId } = await new PrivyClient(APP_ID, APP_SECRET).verifyAuthToken(token);
    return userId ?? null;
  } catch {
    // Token expirado/forjado/de outra app. Falha fechada, sempre.
    return null;
  }
}

const nomeDoGrupo = (competition: string | null | undefined): string =>
  (competition ?? 'World Cup').toUpperCase();

export async function GET(req: Request): Promise<NextResponse> {
  const did = await didVerificado(req);
  if (!did) {
    return NextResponse.json(
      { error: 'sem sessão verificada — o modo demo não usa esta rota' },
      { status: 401 },
    );
  }

  const db = createDb();
  const [txline, cache] = await Promise.allSettled([
    fixturesTxline(),
    createMatchRepo(db).listCached(),
  ]);
  const fixtures: ApiFixture[] = [];

  // As duas fontes são independentes e começam juntas: a devnet lenta não
  // segura um replay que já está pronto no Postgres.
  if (txline.status === 'fulfilled') {
    for (const fx of txline.value) {
      fixtures.push({
        id: String(fx.fixtureId),
        // gameState 1 = agendada. Só é "ao vivo" quando o feed disser que é —
        // nunca por otimismo da tela.
        live: fx.gameState === 2,
        status: fx.gameState === 2 ? 'AO VIVO' : 'AGENDADA',
        group: nomeDoGrupo(fx.competition),
        teamA: fx.p1,
        teamB: fx.p2,
        // Sem bola rolando não há placar. `null` é "ausente", e ausente NÃO é
        // zero (A4): 0–0 aqui seria afirmar um empate que ninguém jogou.
        scoreA: null,
        scoreB: null,
        source: 'txline',
      });
    }
  } else {
    // A devnet fora do ar não pode derrubar a partida gravada: ela é justamente
    // o que existe para a demo não depender da rede (A1).
    const e = txline.reason;
    console.error('[palpitei] /fixtures/snapshot falhou:', e instanceof Error ? e.message : e);
  }

  if (cache.status === 'fulfilled') {
    for (const fx of cache.value) {
      const base = {
        live: false,
        group: nomeDoGrupo(fx.competition),
        teamA: fx.p1,
        teamB: fx.p2,
        scoreA: null,
        scoreB: null,
        // O selo diz de onde o dado REALMENTE veio, não de onde seria bonito
        // que viesse. `cache_source` é gravado pelo ingestor.
        source: (fx.cacheSource ?? 'txline-cache') as ApiFixture['source'],
      } satisfies Omit<ApiFixture, 'id' | 'status'>;
      // A partida VALENDO: paga XP — cada fã, na primeira jogada dele.
      fixtures.push({ ...base, id: String(fx.fixtureId), status: 'REPLAY' });
      // E a irmã de TREINO: mesma partida, XP sempre 0, nada persistido.
      // Existe para rejogar com o gabarito decorado sem corromper o ranking.
      fixtures.push({ ...base, id: `treino-${fx.fixtureId}`, status: 'TREINO', treino: true });
    }
  } else {
    const e = cache.reason;
    console.error('[palpitei] cache do Postgres falhou:', e instanceof Error ? e.message : e);
  }

  return NextResponse.json({ fixtures });
}
