// Credenciamento do SERVIÇO na TxLINE: guest JWT + apiToken.
//
// ATENÇÃO — não confunda com a identidade do FÃ. Isto aqui é o Palpitei se
// apresentando para a TxLINE; é uma credencial única do processo, igual para
// todo mundo. A identidade do usuário é o privy_did verificado, mora em outro
// pacote, e NUNCA vem do corpo da requisição.
//
// Diferença para o v0: o estado NÃO é mais o arquivo .txline-state.json (aquilo
// era da bancada, que importava as credenciais do txline-spike pelo disco). Aqui
// as credenciais entram por variável de ambiente e vivem em MEMÓRIA; quem quiser
// injetar/renovar em runtime usa setCredentials().
//
// O credenciamento on-chain (wallet -> subscribe -> activate) que EMITE o
// apiToken continua fora deste pacote: ele é feito uma vez, fora do webapp.

import { config } from "./config.ts";
import { TxlineAuthError, TxlineHttpError } from "./errors.ts";
import { info, warn } from "./log.ts";

export type TxlineCredentials = { jwt: string; apiToken: string };

// Semeado do ambiente na PRIMEIRA leitura (não no import): assim o app pode
// carregar o .env depois de importar este módulo sem perder as credenciais.
let mem: TxlineCredentials | null = null;
let avisouSemApiToken = false;

function creds(): TxlineCredentials {
  if (!mem) mem = { jwt: config.jwt, apiToken: config.apiToken };
  return mem;
}

/** Credenciais em uso (cópia — não dá para mutar por fora). */
export function getCredentials(): Readonly<TxlineCredentials> {
  return { ...creds() };
}

/**
 * Injeta/renova credenciais em memória. É por aqui que um credenciamento feito
 * fora do processo (script, painel, rotação de token) entra sem restart.
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

/** Zera a memória (testes). A próxima leitura re-semeia do ambiente. */
export function resetCredentials(): void {
  mem = null;
  avisouSemApiToken = false;
}

/** Status observável, sem vazar segredo no log. */
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

// ---------------------------------------------------------------------------
// Sessão guest
// ---------------------------------------------------------------------------

let renovacaoEmVoo: Promise<string> | null = null;
let renovacoes = 0;

/** POST /auth/guest/start -> { token }. Guarda e devolve o guest JWT novo. */
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
 * Renovação SINGLE-FLIGHT: N requisições que tomam 401 ao mesmo tempo esperam a
 * MESMA sessão guest, em vez de abrirem N sessões (que se invalidariam entre si).
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

/** Garante um JWT em memória; abre sessão guest nova se faltar. */
export async function ensureJwt(): Promise<string> {
  const c = creds();
  if (c.jwt) return c.jwt;
  info("[auth] sem guest JWT — abrindo sessão guest…");
  return renovaJwt();
}

// ---------------------------------------------------------------------------
// Cliente HTTP
// ---------------------------------------------------------------------------

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
 * fetch autenticado com retry single-flight no 401: renova o guest JWT UMA vez e
 * repete a requisição. Devolve a Response crua (quem chama decide o que fazer
 * com o status) — use txlineGet() para JSON.
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
    // Descarta o corpo antes de repetir: Response não consumida segura o socket.
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

/** GET autenticado que devolve JSON, ou lança TxlineHttpError com o status. */
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
