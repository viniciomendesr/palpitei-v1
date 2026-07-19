
import { NextResponse } from 'next/server';
import { PrivyClient } from '@privy-io/server-auth';
import { createMatchRepo, createParticipationRepo, createUserRepo } from '@palpitei/db';
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
  const user = await createUserRepo(db).findOrCreateByPrivyDid(did);
  const [txline, cache, aoVivo, jogadasDoFa] = await Promise.allSettled([
    fixturesTxline(),
    matches.listCached(),
    matches.list({ state: 'live' }),
    createParticipationRepo(db).listPlayedFixtures(user.id),
  ]);
  const fixtures: ApiFixture[] = [];

  // "Meus palpites" needs a record to open; a fan who never played gets the
  // button disabled rather than hidden, so a failed read must not silently
  // enable it. An empty set means "we know of no participation".
  const jogadas = new Set<number>(
    jogadasDoFa.status === 'fulfilled' ? jogadasDoFa.value : [],
  );
  if (jogadasDoFa.status === 'rejected') {
    console.error('[palpitei] participações do fã falharam:', jogadasDoFa.reason);
  }

  // The snapshot's GameState lags: it still read 1 while real score events were
  // already arriving, so a running match never reached the "Ao Vivo" tab. Our own
  // state is written from the FIRST persisted score event (server/live.ts), which
  // is feed evidence rather than a poll — so it is the stronger signal, not a guess.
  const idsAoVivo = new Set<number>(
    aoVivo.status === 'fulfilled' ? aoVivo.value.map((f) => f.fixtureId) : [],
  );
  if (aoVivo.status === 'rejected') {
    console.error('[palpitei] estado ao vivo do cache falhou:', aoVivo.reason);
  }

  if (txline.status === 'fulfilled') {
    await matches.upsertMany(txline.value);
    for (const fx of txline.value) {
      const rolando = fx.gameState === 2 || idsAoVivo.has(fx.fixtureId);
      fixtures.push({
        id: String(fx.fixtureId),
        live: rolando,
        status: rolando ? 'AO VIVO' : 'AGENDADA',
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
      // One card per recorded match. The `treino-<id>` route still works and is
      // still what `parseRoomId`/`roomPolicy` gate on, but Home no longer offers
      // it: a second card per match bought nothing and doubled the Replays tab.
      fixtures.push({
        ...base,
        id: String(fx.fixtureId),
        status: 'REPLAY',
        played: jogadas.has(fx.fixtureId),
      });
    }
  } else {
    const e = cache.reason;
    console.error('[palpitei] cache do Postgres falhou:', e instanceof Error ? e.message : e);
  }

  return NextResponse.json({ fixtures });
}
