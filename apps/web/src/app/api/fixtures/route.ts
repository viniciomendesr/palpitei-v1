
import { NextResponse } from 'next/server';
import { PrivyClient } from '@privy-io/server-auth';
import { createMatchRepo } from '@palpitei/db';
import { createDb } from '@/server/db';
import { fixturesTxline } from '@/server/fixtures';
import type { ApiFixture } from '@/lib/api';

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
  const matches = createMatchRepo(db);
  const [txline, cache] = await Promise.allSettled([
    fixturesTxline(),
    matches.listCached(),
  ]);
  const fixtures: ApiFixture[] = [];

  if (txline.status === 'fulfilled') {
    await matches.upsertMany(txline.value);
    for (const fx of txline.value) {
      fixtures.push({
        id: String(fx.fixtureId),
        live: fx.gameState === 2,
        status: fx.gameState === 2 ? 'AO VIVO' : 'AGENDADA',
        group: nomeDoGrupo(fx.competition),
        teamA: fx.p1,
        teamB: fx.p2,
        scoreA: null,
        scoreB: null,
        source: 'txline',
      });
    }
  } else {
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
        source: (fx.cacheSource ?? 'txline-cache') as ApiFixture['source'],
      } satisfies Omit<ApiFixture, 'id' | 'status'>;
      fixtures.push({ ...base, id: String(fx.fixtureId), status: 'REPLAY' });
      fixtures.push({ ...base, id: `treino-${fx.fixtureId}`, status: 'TREINO', training: true });
    }
  } else {
    const e = cache.reason;
    console.error('[palpitei] cache do Postgres falhou:', e instanceof Error ? e.message : e);
  }

  return NextResponse.json({ fixtures });
}
