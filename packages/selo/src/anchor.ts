/**
 * The TxLINE anchor: TxODDS publishes its own Merkle roots to Solana, and this
 * derives the address where a given day's `daily_scores_roots` root lives.
 *
 * Reading an anchored root is permissionless: a juror needs no TxLINE credential
 * to open the account. That asymmetry is the whole reason the badge points at
 * the anchor instead of carrying provider data.
 */

/** Validation programs are per cluster, so the badge and the anchor must agree. */
export const ANCHOR_PROGRAM_IDS = {
  devnet: '6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J',
  'mainnet-beta': '9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA',
} as const;

export type AnchorCluster = keyof typeof ANCHOR_PROGRAM_IDS;

/** Seed prefix for the daily scores root. Other prefixes exist and are unused here. */
export const DAILY_SCORES_ROOTS_SEED = 'daily_scores_roots';

const MS_PER_DAY = 86_400_000;

/**
 * Days since the Unix epoch, in UTC.
 *
 * The anchor is per DAY, not per fixture, which is exactly why `fixture_id`
 * never has to appear in the metadata: verifying the anchor does not need it.
 */
export function epochDayFrom(timestampMs: number): number {
  if (!Number.isFinite(timestampMs)) {
    throw new Error(`[selo] timestamp inválido para o dia da âncora: ${timestampMs}`);
  }
  return Math.floor(timestampMs / MS_PER_DAY);
}

/**
 * The PDA seeds for a day's scores root: the literal prefix, then the epoch day
 * as a u16 LITTLE-ENDIAN. Endianness is not cosmetic here: big-endian derives a
 * different, empty address, and an empty account looks exactly like "the anchor
 * is not there" rather than "we derived it wrong".
 */
export function dailyScoresRootsSeeds(epochDay: number): Uint8Array[] {
  if (!Number.isInteger(epochDay) || epochDay < 0 || epochDay > 0xffff) {
    throw new Error(`[selo] epoch day fora do alcance de u16: ${epochDay}`);
  }
  const dia = new Uint8Array(2);
  dia[0] = epochDay & 0xff;
  dia[1] = (epochDay >> 8) & 0xff;
  return [new TextEncoder().encode(DAILY_SCORES_ROOTS_SEED), dia];
}
