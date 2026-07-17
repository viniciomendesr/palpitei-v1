/** Estado mínimo necessário para gerenciar abandono e retenção de uma sala. */
export type ManagedRoom = {
  subs: Set<unknown>;
  desligar: ReturnType<typeof setTimeout> | null;
  state: { finished: boolean };
  /** Replay tem runner; ao vivo permanece ligado ao canal até game_finalised. */
  runner: { finishNow(): void; readonly emAndamento: boolean } | null;
  encerrar(): void;
};

export const CARENCIA_MS = 30_000;
export const RETENCAO_FINAL_MS = 10 * 60_000;
export const WATCHDOG_MARGIN_MS = 30_000;

export function cancelarEncerramento(sala: ManagedRoom): void {
  if (sala.desligar) clearTimeout(sala.desligar);
  sala.desligar = null;
}

export function agendarLimpezaFinal(sala: ManagedRoom): void {
  cancelarEncerramento(sala);
  sala.desligar = setTimeout(() => {
    sala.desligar = null;
    if (sala.subs.size === 0) sala.encerrar();
  }, RETENCAO_FINAL_MS);
}

export function agendarFimPorAbandono(sala: ManagedRoom): void {
  if (sala.desligar) return;
  sala.desligar = setTimeout(() => {
    sala.desligar = null;
    if (sala.subs.size === 0 && sala.runner?.emAndamento) {
      // Não reinicia do zero: consome a timeline TxLINE restante, liquida os
      // palpites já feitos e guarda o resumo para quando o fã voltar.
      sala.runner?.finishNow();
    }
  }, CARENCIA_MS);
}

export function agendarEncerramentoSeVazia(sala: ManagedRoom): void {
  if (sala.subs.size !== 0) return;
  // `state.finished` significa que o motor recebeu game_end. Ainda pode haver
  // odds reais depois do apito; enquanto o runner estiver ativo, abandono deve
  // drená-lo e publicar replay_done, não apenas esperar a retenção.
  if (sala.runner?.emAndamento) agendarFimPorAbandono(sala);
  else if (sala.state.finished) agendarLimpezaFinal(sala);
  else agendarFimPorAbandono(sala);
}
