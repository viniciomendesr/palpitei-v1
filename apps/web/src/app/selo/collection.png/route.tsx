/**
 * The Selo TxLINE collection seal, rendered on demand.
 *
 * `/selo/collection.png` — the URL `mint-selo.ts` writes into `collection.json`.
 * A static segment, so it wins over the `[slug]` route next to it.
 *
 * This one takes no parameter and reads no row: the collection is not a match
 * and not a fan, so there is nothing here that could disagree with a document.
 */

import { renderSeloCollectionImage } from '@/server/selo-art.tsx';

export const runtime = 'nodejs';

export function GET(): Response {
  return renderSeloCollectionImage();
}
