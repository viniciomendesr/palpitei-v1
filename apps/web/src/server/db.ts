/** Process-wide database pool. Per-request close is a no-op because requests do not own the pool. */
import { createDb as createPgDb, type Db } from '@palpitei/db';

const CHAVE = '__palpitei_web_db__' as const;
type GlobalComDb = typeof globalThis & { [CHAVE]?: Db };

function compartilhado(): Db {
  const globalComDb = globalThis as GlobalComDb;
  if (!globalComDb[CHAVE]) globalComDb[CHAVE] = createPgDb();
  return globalComDb[CHAVE];
}

/** Route-facing database interface that preserves process ownership of the pool. */
export function createDb(): Db {
  const db = compartilhado();
  return {
    pool: db.pool,
    query: db.query,
    withTx: db.withTx,
    close: async () => {},
  };
}
