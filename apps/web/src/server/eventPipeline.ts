/**
 * Fila serial para o caminho TxLINE → Postgres → sala.
 *
 * Fica sem imports de framework/banco para que a garantia crítica de ordem seja
 * verificável pelo node:test: persistência concluída antes da publicação.
 */

/** A menor interface da fila, suficiente para testes sem banco/SSE. */
export type FilaDeEventos = { fila: Promise<void> };

/**
 * Mantém a fila viva e só publica depois que a gravação do MESMO evento acabou.
 *
 * O callback do EventSource é síncrono; por isso ele enfileira e devolve. Erro de
 * escrita nunca pode escapar como rejection não tratada, nem deixar a fila morta
 * para os eventos seguintes. `aoFalhar` é responsável por observabilidade segura.
 */
export function enfileirarPersistenciaAntesDePublicar(
  fila: FilaDeEventos,
  persistir: () => Promise<void>,
  publicar: () => void,
  aoFalhar: (erro: unknown) => void,
): void {
  const registrarFalha = (erro: unknown): void => {
    try {
      aoFalhar(erro);
    } catch {
      // A telemetria não pode quebrar o processador do stream.
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
        publicar();
      } catch (erro) {
        // O caminho normal de publicação já isola cada handler. Este cinto evita
        // que qualquer regressão futura deixe a fila rejeitada.
        registrarFalha(erro);
      }
    })
    .catch(registrarFalha);
}
