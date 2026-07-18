
import { NextResponse } from 'next/server';
import { createDb } from '@/server/db';
import { fixturesDosCanais, iniciarCanalAoVivo, statusDoCanal } from '@/server/live';
import { getPregameOddsStatus } from '@/server/pregameOdds';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  iniciarCanalAoVivo();

  const status = statusDoCanal();
  const fixtureIds = fixturesDosCanais();

  let banco: Record<string, unknown> | null = null;
  if (fixtureIds.length) {
    try {
      const db = createDb();
      const porFixture = await Promise.all(fixtureIds.map(async (fixtureId) => {
        const [ev] = await db.query('select count(*)::int as n from match_events where fixture_id = $1', [fixtureId]);
        const [od] = await db.query('select count(*)::int as n from match_odds where fixture_id = $1', [fixtureId]);
        return [fixtureId, { matchEvents: Number(ev?.n ?? 0), matchOdds: Number(od?.n ?? 0) }] as const;
      }));
      banco = { porFixture: Object.fromEntries(porFixture) };
    } catch (e) {
      banco = { erro: e instanceof Error ? e.message : String(e) };
    }
  }

  return NextResponse.json({ ...status, banco, pregameOdds: getPregameOddsStatus() });
}
