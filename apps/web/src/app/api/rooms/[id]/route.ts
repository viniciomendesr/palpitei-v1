/**
 * GET /api/rooms/:id — a partida REAL: placar, relógio e lances. Exige login.
 *
 * Mesma regra da /api/fixtures: o modo demo (§5.1) não passa por aqui, roda no
 * mock. Sem Bearer verificado é 401, nunca fallback silencioso para dado
 * inventado (G6).
 *
 * Este endpoint NÃO devolve o payload cru da TxLINE. Devolve a leitura derivada
 * que a tela precisa — o §7 licencia o dado só para o hackathon e proíbe
 * redistribuição, e despejar 962 payloads no browser é distribuir dataset, não
 * mostrar produto.
 *
 * ─── as duas armadilhas que este arquivo existe para não repetir ───
 *
 * 1. GOL É DELTA DO BLOCO Score, nunca a contagem de `action === 'goal'`.
 *    Medido nesta partida (18241006, England × Argentina): a ação `goal` aparece
 *    NOVE vezes e o placar muda TRÊS. Os outros seis são VAR/amend/repetição.
 *    Contar ação daria 9 × 2 num jogo que terminou 1 × 2.
 *
 * 2. `hasScore: false` ⇒ goals/corners vêm 0 de placeholder e NÃO valem como
 *    placar (A4). Ler esses zeros faz o placar REGREDIR a 0–0 no meio do jogo —
 *    gol fantasma ao contrário. Só evento com bloco Score move o placar.
 */

import { NextResponse } from 'next/server';
import { PrivyClient } from '@privy-io/server-auth';
import { createEventRepo, createMatchRepo } from '@palpitei/db';
import { createDb } from '@/server/db';
import { criarFiltroDeLances } from '@/server/lances';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '';
const APP_SECRET = process.env.PRIVY_APP_SECRET ?? '';


export interface RoomEvent {
  seq: number;
  ts: number;
  /** Minuto de jogo, do relógio do FEED — nunca do relógio de parede. */
  minute: number | null;
  action: string;
  /** Placar DEPOIS deste lance. null quando o evento não move o placar. */
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

    // O apito inicial ancora o minuto. Sem ele o relógio começaria no primeiro
    // evento do feed — que pode ser 44 min antes da bola rolar (G4).
    const kickoff = eventos.find((e) => e.action === 'kickoff') ?? eventos[0];
    const minutoDe = (e: (typeof eventos)[number]): number | null => {
      if (typeof e.clockSeconds === 'number') return Math.floor(e.clockSeconds / 60);
      if (!kickoff) return null;
      return Math.max(0, Math.floor((e.ts - kickoff.ts) / 60_000));
    };

    const timeline: RoomEvent[] = [];
    let placar = { p1: 0, p2: 0 };
    // A MESMA regra que a sala ao vivo usa (server/lances.ts). Estava duplicada
    // aqui, e as duas cópias divergiram: a sala mostrava "37’ Chute" quatro vezes
    // enquanto esta rota já filtrava. Uma regra, um lugar.
    const ehLance = criarFiltroDeLances();

    for (const e of eventos) {
      // Só evento COM bloco Score move o placar (A4).
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
        // O selo diz o que o ingestor gravou. Nunca um rótulo escolhido aqui.
        source: fixture.cacheSource ?? 'txline-cache',
        startTime: fixture.startTime ?? null,
      },
      /** Placar final pelo delta acumulado — a única leitura que fecha em 1 × 2. */
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
