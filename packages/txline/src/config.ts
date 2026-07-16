// Configuração do pacote, lida de variáveis de ambiente.
//
// Tudo aqui é GETTER, não valor congelado no import. O v0 congelava a config no
// topo do módulo e por isso precisou de um `refreshAuthFromDisk()` para cobrir a
// ordem de boot ("o estado foi gravado DEPOIS deste módulo carregar"). Getter
// mata a classe inteira de bug: quem carregar o .env (o app, o --env-file do
// Node) pode fazer isso a qualquer momento antes do primeiro uso.
//
// O pacote NÃO carrega .env sozinho: biblioteca que mexe no ambiente do processo
// é surpresa. Quem carrega é a aplicação (ou o --env-file-if-exists dos scripts).

const trim = (v: string | undefined): string => (v ?? "").trim();
const semBarraFinal = (v: string): string => v.replace(/\/+$/, "");

function numEnv(nome: string, padrao: number): number {
  const bruto = trim(process.env[nome]);
  if (!bruto) return padrao;
  const n = Number(bruto);
  return Number.isFinite(n) ? n : padrao;
}

export const config = {
  /** Origem da API. Padrão: devnet (a rede do hackathon). */
  get apiOrigin(): string {
    return semBarraFinal(trim(process.env.TXLINE_API_ORIGIN) || "https://txline-dev.txodds.com");
  },
  get apiBaseUrl(): string {
    return semBarraFinal(trim(process.env.TXLINE_API_BASE_URL) || `${this.apiOrigin}/api`);
  },
  get jwtUrl(): string {
    return trim(process.env.TXLINE_JWT_URL) || `${this.apiOrigin}/auth/guest/start`;
  },

  /** Guest JWT de partida. Vazio = o cliente abre uma sessão guest sozinho. */
  get jwt(): string {
    return trim(process.env.TXLINE_JWT);
  },
  /**
   * Token de assinatura do serviço (X-Api-Token). Vem do credenciamento on-chain
   * (wallet -> subscribe -> activate), feito fora daqui. SEM ele os endpoints de
   * dados respondem 401/403 — e o guest JWT sozinho não resolve.
   */
  get apiToken(): string {
    return trim(process.env.TXLINE_API_TOKEN);
  },

  /** 72 = World Cup. Vazio = busca tudo e filtra por "World Cup" (fallback do spike). */
  get competitionId(): string {
    return process.env.TXLINE_COMPETITION_ID?.trim() ?? "72";
  },

  get httpTimeoutMs(): number {
    return numEnv("TXLINE_HTTP_TIMEOUT_MS", 20_000);
  },

  // --- varredura de /updates ---
  /** Requisições simultâneas na varredura de baldes. Conservador de propósito. */
  get sweepConcurrency(): number {
    return Math.max(1, Math.floor(numEnv("TXLINE_SWEEP_CONCURRENCY", 4)));
  },
  get sweepHoursBefore(): number {
    return numEnv("TXLINE_SWEEP_HOURS_BEFORE", 1);
  },
  get sweepHoursAfter(): number {
    return numEnv("TXLINE_SWEEP_HOURS_AFTER", 4);
  },

  // --- ingestão ---
  get liveIngest(): boolean {
    return trim(process.env.TXLINE_LIVE_INGEST) !== "false";
  },
  /**
   * Gerador sintético. Só "true" liga, e ele é DEV-ONLY: a regra do hackathon
   * exige a TxLINE como fonte primária/ao vivo, e "simulado" aceitável é o feed
   * simulado DA TxLINE (os replays da devnet), não um gerador nosso.
   * NUNCA em demo/submissão.
   */
  get allowSynthetic(): boolean {
    return trim(process.env.TXLINE_ALLOW_SYNTHETIC) === "true";
  },
  /** 60 = 1 min de jogo por segundo real. */
  get replaySpeed(): number {
    return numEnv("REPLAY_SPEED", 60);
  },
};
