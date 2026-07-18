import { assertDbReady } from '@palpitei/db';
import { NextResponse } from 'next/server';
import { createDb } from '@/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const readiness = await assertDbReady(createDb());
    return NextResponse.json({ ok: true, migrations: readiness.migrations });
  } catch (error) {
    console.error('[health] banco indisponível ou schema incompatível:', error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
