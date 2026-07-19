/**
 * Pure decisions taken by the global ranking screen.
 *
 * The screen itself has no test tooling (there is no DOM harness here), so anything
 * that is a decision rather than markup lives in this module and is pinned by
 * `test/ranking-trophies.test.ts`.
 */

/**
 * Whether a ranking row draws its trophy mark.
 *
 * Trophies are scarce on purpose: today the only way to earn one is the live debut,
 * once per account, so nearly every row in a top 50 holds none. Printing "0" on
 * forty-nine rows would repeat a zero down the whole screen and make the rarest thing
 * in the product the loudest thing on it, right next to the XP that is supposed to
 * lead. So a zero draws nothing, and the absence of the mark IS the zero: the mark
 * only ever appears with a positive count, which makes "no mark" a statement, not a
 * gap. It is never an unknown either — the balance is `sum(delta)` over the ledger and
 * a fan with no rows resolves to a real 0 in SQL (`coalesce`), never to null.
 *
 * The ledger can in principle go negative (`delta` is signed, `perk_redeem` spends), so
 * anything at or below zero is treated the same way: no mark.
 */
export function showsTrophyMark(balance: number): boolean {
  return Number.isFinite(balance) && balance > 0;
}
