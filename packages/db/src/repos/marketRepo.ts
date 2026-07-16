// marketRepo — prévia da v2 (Presságio) com USDC SIMULADO.
//
// NÃO há dinheiro real na v1. Isto existe porque os motores portados do v0
// incluem o mercado paramutuel e o EnginePorts pede um `saveBet`.
//
// Mesma disciplina do XP: creditar/debitar saldo é irreversível na prática, e o
// replay reemite tudo. Toda mudança de saldo aqui é presa a um CAS — o débito
// só acontece se a aposta ENTROU agora; o pagamento só acontece se o mercado
// virou de não-resolvido para resolvido nesta chamada.

import type { Db } from '../pool.js';
import type { Bet, Market, MarketOutcome } from '../types.js';

export function createMarketRepo(db: Db) {
  const repo = {
    /**
     * Grava o mercado (abertura, prazo, pools).
     *
     * `save()` NUNCA escreve state='resolved' — nem no insert, nem no update.
     * Resolver é `resolve()`, e só ele, porque resolver É PAGAR: as duas coisas
     * acontecem na mesma transação, sob o mesmo CAS (`where state <> 'resolved'`).
     *
     * Sem esta trava havia um jeito silencioso de ninguém receber: o motor marca
     * o mercado como resolvido em memória e emite `market_resolved`; se quem
     * escuta chamar saveMarket(m) antes de markets.resolve(market, bets), o
     * save() vira o state para 'resolved' e QUEIMA o CAS — o resolve() seguinte
     * não acha linha, devolve {pagou:false} e o saldo de todo mundo fica onde
     * estava. Nada estoura. (Medido: era exatamente isso que acontecia.)
     * Por isso 'resolved' aqui é rebaixado para 'closed' e o pagamento continua
     * sendo a única porta que resolve.
     */
    async save(m: Market): Promise<void> {
      const estadoGravavel = m.state === 'resolved' ? 'closed' : m.state;
      await db.query(
        `
        insert into markets (id, fixture_id, kind, labels, rake_bps, closes_at, state,
                             pools, winner, refunded, proof, proof_error)
        values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb, $9, $10, $11::jsonb, $12)
        on conflict (id) do update set
          -- Mercado resolvido não volta a abrir por reprocessamento. E o caminho
          -- inverso também está fechado: excluded.state nunca é 'resolved' (só
          -- resolve() resolve, porque só ele paga). Ver o comentário do save().
          state       = case when markets.state = 'resolved' then markets.state else excluded.state end,
          closes_at   = coalesce(excluded.closes_at, markets.closes_at),
          pools       = excluded.pools,
          winner      = coalesce(markets.winner, excluded.winner),
          refunded    = markets.refunded or excluded.refunded,
          proof       = coalesce(excluded.proof, markets.proof),
          proof_error = coalesce(excluded.proof_error, markets.proof_error),
          updated_at  = now()
        `,
        [
          m.id,
          m.fixtureId,
          m.kind ?? 'resultado_final',
          JSON.stringify(m.labels),
          m.rakeBps,
          m.closesAt ?? null,
          estadoGravavel,
          JSON.stringify(m.pools),
          m.winner ?? null,
          m.refunded ?? false,
          m.proof == null ? null : JSON.stringify(m.proof),
          m.proofError ?? null,
        ]
      );
    },

    /**
     * Registra a aposta e debita o saldo — os dois juntos ou nenhum dos dois.
     * `on conflict do nothing` + `returning`: se a aposta já existia (replay,
     * reenvio, retry), não há segundo débito.
     *
     * O CHECK de `balance_cents >= 0` é a última linha de defesa: se o motor
     * achava que dava e o banco discorda, a transação estoura aqui — alto — em
     * vez de deixar um saldo negativo passeando.
     */
    async saveBet(b: Bet): Promise<boolean> {
      return db.withTx(async (tx) => {
        const rows = await tx.query(
          `insert into bets (id, market_id, user_id, outcome, amount_cents, ts)
           values ($1, $2, $3, $4, $5, $6)
           on conflict (id) do nothing
           returning id`,
          [b.id, b.marketId, b.userId, b.outcome, b.amountCents, b.ts]
        );
        if (rows.length === 0) return false;

        try {
          await tx.query(
            `update users set balance_cents = balance_cents - $2, updated_at = now() where id = $1`,
            [b.userId, b.amountCents]
          );
        } catch (e) {
          if ((e as { code?: string }).code === '23514') {
            throw new Error('saldo insuficiente — a aposta não entrou');
          }
          throw e;
        }
        return true;
      });
    },

    /**
     * Resolve o mercado e paga, uma vez só.
     *
     * O CAS está no `where state <> 'resolved'`: se o mercado já tinha sido
     * resolvido, nenhuma linha volta e ninguém é pago de novo. É o mesmo
     * cuidado que o v0 tinha em memória ("resolve() duas vezes é no-op") —
     * agora garantido pelo banco, que sobrevive ao restart.
     */
    async resolve(
      market: Market,
      bets: Bet[]
    ): Promise<{ pagou: boolean; creditados: number }> {
      return db.withTx(async (tx) => {
        const virou = await tx.query(
          `update markets
              set state = 'resolved', winner = $2, refunded = $3, updated_at = now()
            where id = $1 and state <> 'resolved'
            returning id`,
          [market.id, market.winner ?? null, market.refunded ?? false]
        );
        if (virou.length === 0) return { pagou: false, creditados: 0 };

        let creditados = 0;
        for (const b of bets) {
          const payout = Math.max(0, Math.trunc(b.payoutCents ?? 0));
          await tx.query(`update bets set payout_cents = $2 where id = $1`, [b.id, payout]);
          if (payout > 0) {
            await tx.query(
              `update users set balance_cents = balance_cents + $2, updated_at = now() where id = $1`,
              [b.userId, payout]
            );
            creditados++;
          }
        }
        return { pagou: true, creditados };
      });
    },

    async attachProof(marketId: string, proof: unknown | null, error?: string): Promise<void> {
      await db.query(
        `update markets set proof = coalesce($2::jsonb, proof), proof_error = coalesce($3, proof_error),
                            updated_at = now()
          where id = $1`,
        [marketId, proof == null ? null : JSON.stringify(proof), error ?? null]
      );
    },

    async findByFixture(fixtureId: number): Promise<Market | null> {
      const rows = await db.query(
        `select id, fixture_id, kind, labels, rake_bps, closes_at, state, pools,
                winner, refunded, proof, proof_error
           from markets where fixture_id = $1 order by created_at desc limit 1`,
        [fixtureId]
      );
      const r = rows[0];
      if (!r) return null;
      const m: Market = {
        id: String(r.id),
        fixtureId: Number(r.fixture_id),
        kind: String(r.kind),
        labels: r.labels as Record<MarketOutcome, string>,
        rakeBps: Number(r.rake_bps),
        closesAt: r.closes_at == null ? null : Number(r.closes_at),
        state: r.state as Market['state'],
        pools: r.pools as Record<MarketOutcome, number>,
        refunded: Boolean(r.refunded),
      };
      if (r.winner != null) m.winner = r.winner as MarketOutcome;
      if (r.proof != null) m.proof = r.proof;
      if (r.proof_error != null) m.proofError = String(r.proof_error);
      return m;
    },

    async listBets(marketId: string): Promise<Bet[]> {
      const rows = await db.query(
        `select id, market_id, user_id, outcome, amount_cents, ts, payout_cents
           from bets where market_id = $1 order by ts`,
        [marketId]
      );
      return rows.map((r) => {
        const b: Bet = {
          id: String(r.id),
          marketId: String(r.market_id),
          userId: String(r.user_id),
          outcome: r.outcome as MarketOutcome,
          amountCents: Number(r.amount_cents),
          ts: Number(r.ts),
        };
        if (r.payout_cents != null) b.payoutCents = Number(r.payout_cents);
        return b;
      });
    },
  };

  return repo;
}

export type MarketRepo = ReturnType<typeof createMarketRepo>;
