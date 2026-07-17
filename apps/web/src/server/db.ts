/**
 * Pool compartilhado pelo processo web.
 *
 * `createDb()` do pacote db cria um Pool de verdade. Chamá-lo em toda rota
 * multiplicava handshakes e o teto de conexões (10 por request/sala). Esta
 * fachada mantém um único Pool e transforma `close()` em no-op: uma request
 * não é dona da conexão do processo e portanto não pode encerrá-la.
 *
 * O holder em globalThis também sobrevive ao hot reload do Next em dev.
 */
import { createDb as createPgDb, type Db } from '@palpitei/db';

const CHAVE = '__palpitei_web_db__' as const;
type GlobalComDb = typeof globalThis & { [CHAVE]?: Db };

function compartilhado(): Db {
  const globalComDb = globalThis as GlobalComDb;
  if (!globalComDb[CHAVE]) globalComDb[CHAVE] = createPgDb();
  return globalComDb[CHAVE];
}

/** Mesma interface esperada pelas rotas, mas sem transferir a posse do Pool. */
export function createDb(): Db {
  const db = compartilhado();
  return {
    pool: db.pool,
    query: db.query,
    withTx: db.withTx,
    close: async () => {},
  };
}
