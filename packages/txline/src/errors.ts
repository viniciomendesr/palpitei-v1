// Typed errors keep HTTP status available throughout the replay chain.

export class TxlineHttpError extends Error {
  status: number;
  path: string;
  body: string;

  constructor(status: number, path: string, body: string) {
    super(`TxLINE HTTP ${status} em ${path}${body ? `: ${body.slice(0, 200)}` : ""}`);
    this.name = "TxlineHttpError";
    this.status = status;
    this.path = path;
    this.body = body;
  }
}

export class TxlineAuthError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "TxlineAuthError";
  }
}

/**
 * Every update bucket failed. This distinguishes invalid credentials from a
 * fixture that genuinely has no devnet data.
 */
export class TxlineSweepError extends Error {
  attempts: number;
  byStatus: Record<string, number>;

  constructor(feed: string, fixtureId: number, attempts: number, byStatus: Record<string, number>) {
    const summary = Object.entries(byStatus)
      .map(([s, n]) => `${s}×${n}`)
      .join(", ");
    super(
      `varredura de /${feed}/updates da fixture ${fixtureId} falhou em TODAS as ${attempts} requisições (${summary}). ` +
        `Não é "partida sem dados": é erro de rede/credencial. Confira TXLINE_API_TOKEN e TXLINE_JWT.`
    );
    this.name = "TxlineSweepError";
    this.attempts = attempts;
    this.byStatus = byStatus;
  }
}

export function isHttpStatus(e: unknown, status: number): boolean {
  return e instanceof TxlineHttpError && e.status === status;
}

/** Short log message without a stack trace. */
export function errorMessage(e: unknown): string {
  if (e instanceof TxlineHttpError) return `HTTP ${e.status}`;
  if (e instanceof Error) return e.message;
  return String(e);
}
