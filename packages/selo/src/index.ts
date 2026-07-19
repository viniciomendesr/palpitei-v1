// Selo TxLINE: metadata, the TxODDS anchor address, and the one-off mint script.
// Nothing here runs in the web app: the mint path is operational, not runtime.

export {
  ANCHOR_PROGRAM_IDS,
  DAILY_SCORES_ROOTS_SEED,
  dailyScoresRootsSeeds,
  epochDayFrom,
} from './anchor.ts';
export type { AnchorCluster } from './anchor.ts';

export {
  ANCHOR_HEADER_BYTES,
  ROOT_BYTES,
  anchorAccountEpochDay,
  anchorAccountRoots,
  bytesEqual,
  decodeHash32,
  decodeProofPath,
  foldProof,
  verifyEventStatRoot,
} from './anchor-verification.ts';
export type { AnchorVerification, ProofNode } from './anchor-verification.ts';

export {
  SELO_NAME,
  SELO_COLLECTION_NAME,
  assertNoCorrectnessClaim,
  assertNoLicensedData,
  buildSeloMetadata,
  isoDate,
  isoMinute,
  matchSlug,
  metadataFileName,
} from './metadata.ts';
export type { SeloAttribute, SeloMetadata, SeloMetadataInput } from './metadata.ts';
