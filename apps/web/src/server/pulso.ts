/**
 * O pulso do SSE — um comentário `: ping` em intervalo fixo, por conexão.
 *
 * Existe por causa do AO VIVO. No replay o feed fala o tempo todo e ninguém
 * percebe a falta dele; numa partida real há MINUTOS de silêncio entre lances,
 * e proxy de borda (o do Railway incluído) derruba conexão SSE ociosa. A queda
 * é silenciosa na tela: o EventSource tenta voltar sozinho — reusando a mesma
 * URL, com o token velho — e é exatamente o caminho que congela a sala
 * (useSala.ts conta o resto dessa história).
 *
 * Comentário SSE (linha que começa com `:`) é a ferramenta certa: atravessa o
 * proxy como tráfego e mantém a conexão viva, mas NÃO dispara `onmessage` no
 * browser — o cliente não precisa filtrar pacote de mentira.
 *
 * Vive fora do route handler de propósito: o /stream exige Bearer verificado
 * da Privy e não dá para exercitá-lo por curl sem um login real. Aqui o
 * intervalo é só timer e função, provado por teste de unidade
 * (test/pulso.test.ts); o route só liga e desliga.
 */

/** ~20s: folga confortável contra timeouts de ociosidade usuais (30–60s). */
export const PULSO_MS = 20_000;

/** A linha crua do heartbeat. Comentário SSE: começa em `:`, termina em `\n\n`. */
export const PULSO = ': ping\n\n';

/**
 * Dispara `enviar` a cada `intervaloMs` até a função devolvida ser chamada.
 * Quem abre a conexão tem a obrigação de chamá-la no abort E no cancel: timer
 * órfão segura a closure da sala para sempre — vazamento por conexão.
 *
 * `enviar` que lança (enqueue em conexão já morta) não derruba o timer nem o
 * processo: um assinante morto não pode matar a sala dos outros, que é a mesma
 * regra do `publicar` de rooms.ts.
 */
export function iniciarPulso(enviar: () => void, intervaloMs: number = PULSO_MS): () => void {
  const timer = setInterval(() => {
    try {
      enviar();
    } catch {
      // Conexão fechada entre um pulso e outro: o abort/cancel limpa o timer.
    }
  }, intervaloMs);
  return () => clearInterval(timer);
}
