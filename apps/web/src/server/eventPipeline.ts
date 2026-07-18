/** Framework-independent serial pipeline for TxLINE persistence and publication. */

/** Minimal queue interface for database-free tests. */
export type FilaDeEventos = { fila: Promise<void> };

/** Persists each event before publishing it and keeps the queue available after failures. */
export function enfileirarPersistenciaAntesDePublicar(
  fila: FilaDeEventos,
  persistir: () => Promise<void>,
  publicar: () => unknown,
  aoFalhar: (erro: unknown) => void,
): void {
  const registrarFalha = (erro: unknown): void => {
    try {
      aoFalhar(erro);
    } catch {
      // Observability failures must not interrupt stream processing.
    }
  };

  fila.fila = fila.fila
    .then(async () => {
      try {
        await persistir();
      } catch (erro) {
        registrarFalha(erro);
        return;
      }

      try {
        await publicar();
      } catch (erro) {
        // Preserve the queue even if a future publisher bypasses handler isolation.
        registrarFalha(erro);
      }
    })
    .catch(registrarFalha);
}
