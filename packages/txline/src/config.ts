// Environment-backed package configuration. Values are getters so applications
// may load .env before first use; this library never mutates process environment.

const trim = (v: string | undefined): string => (v ?? "").trim();
const semBarraFinal = (v: string): string => v.replace(/\/+$/, "");

function numEnv(nome: string, padrao: number): number {
  const bruto = trim(process.env[nome]);
  if (!bruto) return padrao;
  const n = Number(bruto);
  return Number.isFinite(n) ? n : padrao;
}

export const config = {
  /** API origin. Defaults to the hackathon devnet. */
  get apiOrigin(): string {
    return semBarraFinal(trim(process.env.TXLINE_API_ORIGIN) || "https://txline-dev.txodds.com");
  },
  get apiBaseUrl(): string {
    return semBarraFinal(trim(process.env.TXLINE_API_BASE_URL) || `${this.apiOrigin}/api`);
  },
  get jwtUrl(): string {
    return trim(process.env.TXLINE_JWT_URL) || `${this.apiOrigin}/auth/guest/start`;
  },

  /** Initial guest JWT. Empty means the client creates a guest session. */
  get jwt(): string {
    return trim(process.env.TXLINE_JWT);
  },
  /**
   * Service subscription token (X-Api-Token). Without it data endpoints return
   * 401/403; the guest JWT alone is insufficient.
   */
  get apiToken(): string {
    return trim(process.env.TXLINE_API_TOKEN);
  },

  /** 72 = World Cup. Empty, or a competition the snapshot no longer carries,
   *  falls back to every fixture the feed offers. */
  get competitionId(): string {
    return process.env.TXLINE_COMPETITION_ID?.trim() ?? "72";
  },

  get httpTimeoutMs(): number {
    return numEnv("TXLINE_HTTP_TIMEOUT_MS", 20_000);
  },

  /** Conservative concurrent request limit for /updates bucket scans. */
  get sweepConcurrency(): number {
    return Math.max(1, Math.floor(numEnv("TXLINE_SWEEP_CONCURRENCY", 4)));
  },
  get sweepHoursBefore(): number {
    return numEnv("TXLINE_SWEEP_HOURS_BEFORE", 1);
  },
  get sweepHoursAfter(): number {
    return numEnv("TXLINE_SWEEP_HOURS_AFTER", 4);
  },

  get liveIngest(): boolean {
    return trim(process.env.TXLINE_LIVE_INGEST) !== "false";
  },
  /**
   * Development-only synthetic generator. It requires an explicit "true" and
   * must never power demo or submission flows.
   */
  get allowSynthetic(): boolean {
    return trim(process.env.TXLINE_ALLOW_SYNTHETIC) === "true";
  },
  /** 60 = one match minute per wall-clock second. */
  get replaySpeed(): number {
    return numEnv("REPLAY_SPEED", 60);
  },
};
