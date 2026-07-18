// Live SSE ingestion for scores and odds. It normalizes events, renews JWTs on
// 401/403, reconnects with bounded backoff, and resumes through Last-Event-ID.

import { EventSource } from "eventsource";
import type { NormEvent } from "@palpitei/core";
import { normalizeOdds, normalizeScore } from "@palpitei/core";
import { config } from "../config.ts";
import { getCredentials, startGuestSession } from "../auth.ts";
import { info, warn } from "../log.ts";

export type LiveState = "off" | "connecting" | "open" | "reconnecting";

export type LiveStatus = {
  state: LiveState;
  /** Received SSE events, including payloads that could not be normalized. */
  recebidos: number;
  /** Events successfully normalized to NormEvent. */
  normalizados: number;
  /** Received but discarded because the payload could not be normalized. */
  descartados: number;
  conectadoEm: number | null;
  primeiroEventoEm: number | null;
  ultimoEventoEm: number | null;
  reconexoes: number;
  ultimoErro?: string;
  /** Truncated sample of the latest raw payload for diagnostics. */
  ultimaAmostra?: string;
  lastEventId?: string;
};

function statusNovo(): LiveStatus {
  return {
    state: "off",
    recebidos: 0,
    normalizados: 0,
    descartados: 0,
    conectadoEm: null,
    primeiroEventoEm: null,
    ultimoEventoEm: null,
    reconexoes: 0,
  };
}

export const liveStatus: { scores: LiveStatus; odds: LiveStatus } = {
  scores: statusNovo(),
  odds: statusNovo(),
};

/** Seconds since the latest event; null means none has arrived. */
export function secondsSinceLastEvent(label: "scores" | "odds"): number | null {
  const t = liveStatus[label].ultimoEventoEm;
  return t === null ? null : Math.round((Date.now() - t) / 1000);
}

/** One-line summary for diagnostics and UI status. */
export function liveSummary(): string {
  return (["scores", "odds"] as const)
    .map((l) => {
      const s = liveStatus[l];
      const sil = secondsSinceLastEvent(l);
      return `${l}=${s.state}/${s.normalizados}ev${sil === null ? " (NUNCA recebeu)" : ` (há ${sil}s)`}`;
    })
    .join(" ");
}

const BACKOFF_TETO_MS = 15_000;
const AMOSTRAS_LOGADAS = 3;

type Handle = { close(): void };

let scoresHandle: Handle | null = null;
let oddsHandle: Handle | null = null;

function abreStream(
  label: "scores" | "odds",
  normalize: (raw: unknown) => NormEvent | null,
  onEvent: (ev: NormEvent) => void
): Handle {
  const status = liveStatus[label];
  const url = `${config.apiBaseUrl}/${label}/stream`;

  let es: EventSource | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let backoff = 1000;
  let closed = false;
  let lastEventId: string | undefined;
  let amostrasLogadas = 0;

  Object.assign(status, statusNovo(), { state: "connecting" as LiveState });

  const conecta = (): void => {
    if (closed) return;
    info(`[${label}] SSE conectando em ${url}${lastEventId ? ` (Last-Event-ID: ${lastEventId})` : ""}`);

    es = new EventSource(url, {
      fetch: async (input: any, init: any) => {
        const tenta = (token: string): Promise<Response> => {
          const headers: Record<string, string> = {
            ...(init?.headers as Record<string, string>),
            Accept: "text/event-stream",
            "Cache-Control": "no-cache",
            "Accept-Encoding": "deflate",
            Authorization: `Bearer ${token}`,
            "X-Api-Token": getCredentials().apiToken,
          };
          // The library may already have set the resume header.
          const temId = Object.keys(headers).some((k) => k.toLowerCase() === "last-event-id");
          if (lastEventId && !temId) headers["Last-Event-ID"] = lastEventId;
          return fetch(input, { ...init, headers });
        };

        let res = await tenta(getCredentials().jwt);
        if (res.status === 401 || res.status === 403) {
          warn(`[${label}] SSE ${res.status} ao conectar — renovando guest JWT…`);
          await res.body?.cancel().catch(() => {});
          const jwt = await startGuestSession();
          res = await tenta(jwt);
          if (!res.ok) warn(`[${label}] SSE segue ${res.status} depois de renovar — credencial/assinatura?`);
        }
        return res;
      },
    });

    es.onopen = () => {
      status.state = "open";
      status.conectadoEm = Date.now();
      backoff = 1000;
      info(
        `[${label}] stream ao vivo ABERTO. Atenção: aberto ≠ recebendo — ` +
          `"open / 0 eventos" é o estado A7 e não prova nada.`
      );
    };

    es.onmessage = (ev: any) => {
      status.recebidos += 1;
      const agora = Date.now();
      status.ultimoEventoEm = agora;
      if (status.primeiroEventoEm === null) {
        status.primeiroEventoEm = agora;
        info(`[${label}] 🎉 PRIMEIRO evento ao vivo recebido — o caminho A7 está VIVO.`);
      }
      if (ev.lastEventId) {
        lastEventId = ev.lastEventId;
        status.lastEventId = ev.lastEventId;
      }

      const cru = String(ev.data ?? "");
      status.ultimaAmostra = cru.slice(0, 300);
      if (amostrasLogadas < AMOSTRAS_LOGADAS) {
        amostrasLogadas += 1;
        // Capture initial raw samples to compare live and replay payload shapes.
        info(`[${label}] amostra crua #${amostrasLogadas}: ${cru.slice(0, 300)}`);
      }

      let parsed: unknown = null;
      try {
        parsed = JSON.parse(cru);
      } catch {
        /* handled by the discard counter below */
      }
      const norm = parsed ? normalize(parsed) : null;
      if (!norm) {
        status.descartados += 1;
        // Log the first two drops and then every 50th to preserve signal.
        if (status.descartados <= 2 || status.descartados % 50 === 1) {
          warn(`[${label}] payload não normalizável (#${status.descartados}): ${cru.slice(0, 200)}`);
        }
        return;
      }

      status.normalizados += 1;
      if (status.normalizados % 100 === 1) {
        info(`[${label}] ${status.normalizados} eventos normalizados (fixture ${norm.fixtureId})`);
      }
      try {
        onEvent(norm);
      } catch (e: any) {
        // A failing handler must not terminate the stream.
        warn(`[${label}] handler falhou no evento da fixture ${norm.fixtureId}: ${e?.message}`);
      }
    };

    es.onerror = (err: any) => {
      status.ultimoErro = err?.message || String(err);
      // readyState 2 === CLOSED
      if (es && es.readyState === 2 && !closed) {
        try {
          es.close();
        } catch {}
        status.reconexoes += 1;
        status.state = "reconnecting";
        const espera = Math.min(backoff, BACKOFF_TETO_MS);
        warn(
          `[${label}] conexão caiu (${status.ultimoErro ?? "sem detalhe"}) — ` +
            `reconectando em ${espera}ms (reconexão #${status.reconexoes})…`
        );
        reconnectTimer = setTimeout(conecta, espera);
        backoff = Math.min(backoff * 2, BACKOFF_TETO_MS);
      } else if (!closed) {
        warn(`[${label}] erro no stream (readyState=${es?.readyState}): ${status.ultimoErro}`);
      }
    };
  };

  conecta();

  return {
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        es?.close();
      } catch {}
      status.state = "off";
      info(
        `[${label}] stream fechado — ${status.normalizados} normalizados, ` +
          `${status.descartados} descartados, ${status.reconexoes} reconexões`
      );
    },
  };
}

/**
 * Opens score and odds streams idempotently. Callers receive normalized events
 * and own fixture routing; this package does not know rooms or the message bus.
 */
export function startLiveIngest(onEvent: (ev: NormEvent) => void): void {
  if (scoresHandle || oddsHandle) return;
  if (!config.liveIngest) {
    info("ingestor ao vivo desligado (TXLINE_LIVE_INGEST=false)");
    return;
  }
  info("ingestor ao vivo: abrindo streams SSE de scores e odds…");
  scoresHandle = abreStream("scores", normalizeScore as (raw: unknown) => NormEvent | null, onEvent);
  oddsHandle = abreStream("odds", normalizeOdds as (raw: unknown) => NormEvent | null, onEvent);
}

export function stopLiveIngest(): void {
  scoresHandle?.close();
  oddsHandle?.close();
  scoresHandle = null;
  oddsHandle = null;
}

export function isLiveIngestActive(): boolean {
  return scoresHandle !== null || oddsHandle !== null;
}
