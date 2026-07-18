// TxLINE service credentials: guest JWT plus API token. They identify this
// process, not a fan; user identity is the separately verified privy_did.

import { config } from "./config.ts";
import { TxlineAuthError, TxlineHttpError } from "./errors.ts";
import { info, warn } from "./log.ts";

export type TxlineCredentials = { jwt: string; apiToken: string };

// Seed credentials on first read so applications may load .env after importing.
let mem: TxlineCredentials | null = null;
let avisouSemApiToken = false;

function creds(): TxlineCredentials {
  if (!mem) mem = { jwt: config.jwt, apiToken: config.apiToken };
  return mem;
}

/** Active credentials as an immutable copy. */
export function getCredentials(): Readonly<TxlineCredentials> {
  return { ...creds() };
}

/**
 * Injects or refreshes in-memory credentials without a process restart.
 */
export function setCredentials(patch: Partial<TxlineCredentials>): Readonly<TxlineCredentials> {
  const atual = creds();
  if (patch.jwt !== undefined) atual.jwt = patch.jwt.trim();
  if (patch.apiToken !== undefined) atual.apiToken = patch.apiToken.trim();
  return { ...atual };
}

export function setApiToken(token: string): void {
  setCredentials({ apiToken: token });
}

/** Clears in-memory credentials for tests; next access reseeds from the environment. */
export function resetCredentials(): void {
  mem = null;
  avisouSemApiToken = false;
}

/** Observable status that does not expose secrets. */
export function authStatus(): {
  temJwt: boolean;
  temApiToken: boolean;
  apiBaseUrl: string;
  renovando: boolean;
  renovacoes: number;
} {
  const c = creds();
  return {
    temJwt: !!c.jwt,
    temApiToken: !!c.apiToken,
    apiBaseUrl: config.apiBaseUrl,
    renovando: renovacaoEmVoo !== null,
    renovacoes,
  };
}


let renovacaoEmVoo: Promise<string> | null = null;
let renovacoes = 0;

/** POST /auth/guest/start -> { token }; stores and returns a new guest JWT. */
export async function startGuestSession(): Promise<string> {
  const res = await fetch(config.jwtUrl, {
    method: "POST",
    signal: AbortSignal.timeout(config.httpTimeoutMs),
  });
  const texto = await res.text();
  if (!res.ok) throw new TxlineHttpError(res.status, config.jwtUrl, texto);

  let data: unknown;
  try {
    data = JSON.parse(texto);
  } catch {
    throw new TxlineAuthError(`resposta da sessão guest não é JSON: ${texto.slice(0, 200)}`);
  }
  const jwt = (data as { token?: unknown } | null)?.token;
  if (typeof jwt !== "string" || !jwt) {
    throw new TxlineAuthError(`sem token na resposta da sessão guest: ${texto.slice(0, 200)}`);
  }

  renovacoes += 1;
  setCredentials({ jwt });
  return jwt;
}

/**
 * Single-flight refresh prevents concurrent 401 responses from creating
 * competing guest sessions.
 */
function renovaJwt(): Promise<string> {
  if (!renovacaoEmVoo) {
    warn("[auth] renovando guest JWT…");
    renovacaoEmVoo = startGuestSession().finally(() => {
      renovacaoEmVoo = null;
    });
  }
  return renovacaoEmVoo;
}

/** Returns an in-memory JWT, creating a guest session when necessary. */
export async function ensureJwt(): Promise<string> {
  const c = creds();
  if (c.jwt) return c.jwt;
  info("[auth] sem guest JWT — abrindo sessão guest…");
  return renovaJwt();
}


function headers(jwt: string, extra?: RequestInit["headers"]): Headers {
  const h = new Headers(extra);
  const c = creds();
  if (jwt) h.set("Authorization", `Bearer ${jwt}`);
  if (c.apiToken) h.set("X-Api-Token", c.apiToken);
  else if (!avisouSemApiToken) {
    avisouSemApiToken = true;
    warn(
      "[auth] TXLINE_API_TOKEN vazio — os endpoints de dados vão responder 401/403. " +
        "O guest JWT sozinho não abre o feed; o apiToken vem do credenciamento on-chain."
    );
  }
  return h;
}

/**
 * Authenticated fetch with a single-flight 401 retry. Returns the raw Response;
 * use txlineGet() for JSON.
 */
export async function txlineFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const jwt = await ensureJwt();

  const tenta = (token: string): Promise<Response> =>
    fetch(url, {
      ...init,
      headers: headers(token, init.headers),
      signal: init.signal ?? AbortSignal.timeout(config.httpTimeoutMs),
    });

  let res = await tenta(jwt);
  if (res.status === 401) {
    // Drain the body before retrying so the socket can be released.
    await res.body?.cancel().catch(() => {});
    warn(`[auth] 401 em ${url} — renovando guest JWT e repetindo…`);
    const novo = await renovaJwt();
    res = await tenta(novo);
  }
  return res;
}

type Params = Record<string, string | number | undefined>;

function comQuery(path: string, params?: Params): string {
  const url = path.startsWith("http") ? path : `${config.apiBaseUrl}${path}`;
  if (!params) return url;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${url}${url.includes("?") ? "&" : "?"}${s}` : url;
}

/** Authenticated GET returning JSON or a TxlineHttpError with its status. */
export async function txlineGet<T = unknown>(path: string, params?: Params): Promise<T> {
  const url = comQuery(path, params);
  const res = await txlineFetch(url, { method: "GET" });
  const texto = await res.text();
  if (!res.ok) throw new TxlineHttpError(res.status, url, texto);
  if (!texto) return null as T;
  try {
    return JSON.parse(texto) as T;
  } catch {
    throw new TxlineHttpError(res.status, url, `resposta não-JSON: ${texto.slice(0, 200)}`);
  }
}
