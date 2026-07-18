
import { NextResponse } from 'next/server';
import { PrivyClient } from '@privy-io/server-auth';
import { createEventRepo, createMatchRepo } from '@palpitei/db';
import { createDb } from '@/server/db';
import { createMatchEventFilter } from '@/server/lances';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '';
const APP_SECRET = process.env.PRIVY_APP_SECRET ?? '';


export interface RoomEvent {
  seq: number;
  ts: number;
  minute: number | null;
  action: string;
  goals: { p1: number; p2: number } | null;
}

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

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await didVerificado(req))) {
    return NextResponse.json(
      { error: 'sem sessão verificada — o modo demo não usa esta rota' },
      { status: 401 },
    );
  }

  const fixtureId = Number((await params).id);
  if (!Number.isFinite(fixtureId)) {
    return NextResponse.json({ error: 'fixture inválida' }, { status: 400 });
  }

  const db = createDb();
  try {
    const fixture = await createMatchRepo(db).findById(fixtureId);
    if (!fixture) {
      return NextResponse.json({ error: 'partida não encontrada no cache' }, { status: 404 });
    }

    const eventos = await createEventRepo(db).listReplayByFixture(fixtureId);

    const kickoff = eventos.find((e) => e.action === 'kickoff') ?? eventos[0];
    const minutoDe = (e: (typeof eventos)[number]): number | null => {
      if (typeof e.clockSeconds === 'number') return Math.floor(e.clockSeconds / 60);
      if (!kickoff) return null;
      return Math.max(0, Math.floor((e.ts - kickoff.ts) / 60_000));
    };

    const timeline: RoomEvent[] = [];
    let placar = { p1: 0, p2: 0 };
    const ehLance = createMatchEventFilter();

    for (const e of eventos) {
      const mudou = e.hasScore && (e.goals.p1 !== placar.p1 || e.goals.p2 !== placar.p2);
      if (mudou) placar = { p1: e.goals.p1, p2: e.goals.p2 };

      if (!ehLance(e, mudou)) continue;

      timeline.push({
        seq: e.seq,
        ts: e.ts,
        minute: minutoDe(e),
        action: e.action,
        goals: mudou ? { ...placar } : null,
      });
    }

    return NextResponse.json({
      fixture: {
        id: String(fixture.fixtureId),
        teamA: fixture.p1,
        teamB: fixture.p2,
        group: (fixture.competition ?? 'World Cup').toUpperCase(),
        source: fixture.cacheSource ?? 'txline-cache',
        startTime: fixture.startTime ?? null,
      },
      final: placar,
      timeline,
    });
  } catch (e) {
    console.error('[palpitei] /api/rooms falhou:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'não deu para ler a partida' }, { status: 500 });
  } finally {
    await db.close?.();
  }
}
