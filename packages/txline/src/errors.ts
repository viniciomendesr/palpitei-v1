// Erros tipados. O v0 lia `e?.response?.status` (formato do axios) espalhado
// pela cadeia de replay; aqui o status é um campo de verdade.

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
 * A varredura de baldes falhou INTEIRA. Existe porque o v0 engolia todo erro de
 * balde com `catch {}` — se o token estivesse inválido, os 144 baldes davam 401
 * e o resultado era "0 eventos": idêntico, e indistinguível, de "a devnet não
 * tem essa partida". Falha silenciosa é exatamente o que este projeto não pode ter.
 */
export class TxlineSweepError extends Error {
  tentativas: number;
  porStatus: Record<string, number>;

  constructor(feed: string, fixtureId: number, tentativas: number, porStatus: Record<string, number>) {
    const resumo = Object.entries(porStatus)
      .map(([s, n]) => `${s}×${n}`)
      .join(", ");
    super(
      `varredura de /${feed}/updates da fixture ${fixtureId} falhou em TODAS as ${tentativas} requisições (${resumo}). ` +
        `Não é "partida sem dados": é erro de rede/credencial. Confira TXLINE_API_TOKEN e TXLINE_JWT.`
    );
    this.name = "TxlineSweepError";
    this.tentativas = tentativas;
    this.porStatus = porStatus;
  }
}

export function isHttpStatus(e: unknown, status: number): boolean {
  return e instanceof TxlineHttpError && e.status === status;
}

/** Mensagem curta para log, sem stack. */
export function motivo(e: unknown): string {
  if (e instanceof TxlineHttpError) return `HTTP ${e.status}`;
  if (e instanceof Error) return e.message;
  return String(e);
}
