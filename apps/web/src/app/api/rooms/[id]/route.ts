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
import { createDb, createEventRepo, createMatchRepo } from '@palpitei/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '';
const APP_SECRET = process.env.PRIVY_APP_SECRET ?? '';

/**
 * O que vira lance na tela. O feed tem 962 eventos e 194 deles são
 * `safe_possession`: mostrar tudo é ruído, não narração.
 */
const LANCES = new Set([
  'kickoff',
  'goal',
  'yellow_card',
  'red_card',
  'corner',
  'shot',
  'substitution',
  'injury',
  'additional_time',
  'halftime_finalised',
  'game_finalised',
]);

/**
 * Lance contado ⇒ o contador em `totals` é a verdade; a ação é só o anúncio.
 *
 * A TxLINE emite o lance DUAS vezes: uma ao anunciar e outra ao contabilizar.
 * Medido aqui: escanteio no seq 76 com `corners 0-0` e no seq 77, 12s depois e
 * no mesmo minuto, com `corners 1-0`. Renderizar os dois faz o fã ler
 * "escanteio · escanteio" e o placar de escanteios parecer o dobro.
 *
 * É a MESMA lição do gol (9 ações `goal` para 3 gols), generalizada: o que
 * conta é o delta do contador, nunca a repetição da ação.
 *
 * Gol fica FORA deste mapa de propósito: `e.goals` já é `Total.Goals`, tipado, e
 * é o campo que os motores usam. Duas leituras do mesmo número são duas verdades.
 */
const CONTADORES: Record<string, string> = {
  corner: 'Corners',
  yellow_card: 'YellowCards',
  red_card: 'RedCards',
};

const totalDe = (e: { totals?: { p1: Record<string, number>; p2: Record<string, number> } }, chave: string) => ({
  // Chave AUSENTE no Total é ZERO aqui (G7) — o oposto do bloco Score ausente
  // (A4). O mesmo feed exige as duas leituras, e trocá-las some com linhas da
  // tela ou inventa gol. Por isso a distinção vive em `hasScore`, não aqui.
  p1: e.totals?.p1?.[chave] ?? 0,
  p2: e.totals?.p2?.[chave] ?? 0,
});

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

    const eventos = await createEventRepo(db).listByFixture(fixtureId);

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
    /** Último valor visto de cada contador — a régua do delta. */
    const contado: Record<string, { p1: number; p2: number }> = {};
    /** Lances sem contador (kickoff, apito) vêm em par: o clock desempata. */
    const vistos = new Set<string>();

    for (const e of eventos) {
      // Só evento COM bloco Score move o placar (A4).
      const mudou = e.hasScore && (e.goals.p1 !== placar.p1 || e.goals.p2 !== placar.p2);
      if (mudou) placar = { p1: e.goals.p1, p2: e.goals.p2 };

      if (!LANCES.has(e.action)) continue;

      const chave = CONTADORES[e.action];
      if (e.action === 'goal') {
        // Gol é o delta do placar, e só. `goal` que não moveu o placar é
        // VAR/amend: nesta partida são 9 ações para 3 gols.
        if (!mudou) continue;
      } else if (chave) {
        // Sem bloco Score não dá para saber se o contador andou — e o anúncio
        // vem justamente antes da contagem. Espera o evento que conta.
        if (!e.hasScore) continue;
        const agora = totalDe(e, chave);
        // A régua começa em zero porque a partida começa em zero: sem isto o
        // primeiro escanteio/cartão do jogo seria engolido como "calibração".
        const antes = contado[chave] ?? { p1: 0, p2: 0 };
        contado[chave] = agora;
        if (agora.p1 === antes.p1 && agora.p2 === antes.p2) continue;
      } else {
        // kickoff/apito duplicam no mesmo instante de jogo; um por clock basta.
        const id = `${e.action}:${e.clockSeconds ?? e.ts}`;
        if (vistos.has(id)) continue;
        vistos.add(id);
      }

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
