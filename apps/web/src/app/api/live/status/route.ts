/**
 * O painel do canal ao vivo — os olhos do runbook de 18/07.
 *
 * PÚBLICA de propósito (decisão no docs/live-architecture.md §6): só expõe
 * contadores operacionais e contagens do banco, nenhum dado de fã e nenhum
 * payload da TxLINE (a `ultimaAmostra` fica fora — §7 do hackathon; ela segue
 * nos logs do Railway, que são privados). Autenticá-la faria todos os curls do
 * runbook falharem em 401 e mataria o plano B de boot.
 */

import { NextResponse } from 'next/server';
import { createDb } from '@/server/db';
import { fixturesDosCanais, iniciarCanalAoVivo, statusDoCanal } from '@/server/live';
import { statusOddsPregameTxline } from '@/server/pregameOdds';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  // PRIMEIRA linha, antes de qualquer coisa: é o plano B do boot (idempotente).
  iniciarCanalAoVivo();

  const status = statusDoCanal();
  const fixtureIds = fixturesDosCanais();

  // As contagens do banco provam a persistência (A1): contador que não sobe é
  // sintoma. Falha de banco aparece como erro, nunca como zero inventado.
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

  // Contadores sem payload de cotação: permitem distinguir "a fonte não abriu
  // mercado" de "o snapshot da TxLINE falhou" durante o runbook.
  return NextResponse.json({ ...status, banco, pregameOdds: statusOddsPregameTxline() });
}
