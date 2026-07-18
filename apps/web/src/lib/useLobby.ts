'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, type LobbyState } from '@/lib/api';
import { esperaDeReconexao } from '@/lib/reconexao';
import { acaoDeReentrada } from '@/lib/sala-reentrada';

/** Shown when the fan cannot be put back into the room; silence is the bug being fixed. */
export const ERRO_REENTRADA = 'Não deu para voltar para esta sala. Volte para o início e entre de novo.';

export function useLobby(
  roomId: string,
  partyId: string,
  active: boolean,
  privyAuthenticated: boolean,
) {
  const [state, setState] = useState<LobbyState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Latch: survives reconnects so a permanent refusal can never spin.
  const tentativasRejoin = useRef(0);

  useEffect(() => {
    if (!active || !partyId) return;
    let alive = true;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let tentativasSse = 0;
    tentativasRejoin.current = 0;

    const url = (ticket: string) =>
      `/api/rooms/${encodeURIComponent(roomId)}/lobby?party=${encodeURIComponent(partyId)}&ticket=${encodeURIComponent(ticket)}`;

    /**
     * EventSource never exposes the HTTP status, so a refusal is indistinguishable from
     * a dropped connection. Re-issue a ticket and probe with `fetch` to read it. Tickets
     * are single-use, so the probe burns one — it only runs on the error path.
     */
    const statusDaRecusa = async (): Promise<number | null> => {
      try {
        const { ticket } = await api.sseTicket(roomId, partyId, 'lobby');
        const res = await fetch(url(ticket), { headers: { Accept: 'text/event-stream' } });
        void res.body?.cancel();
        return res.ok ? null : res.status;
      } catch (e) {
        return e instanceof ApiError ? e.status : null;
      }
    };

    const reconectar = () => {
      retry = setTimeout(connect, esperaDeReconexao(tentativasSse++));
    };

    const falhou = async (status: number | null, mensagem: string) => {
      if (!alive) return;
      const acao = acaoDeReentrada({
        status,
        temParty: Boolean(partyId),
        privyAuthenticated,
        tentativas: tentativasRejoin.current,
      });

      if (acao === 'reconectar') {
        setError(mensagem);
        reconectar();
        return;
      }

      if (acao === 'desistir') {
        // No retry scheduled on purpose: the fan reads a message instead of a frozen screen.
        setError(ERRO_REENTRADA);
        return;
      }

      tentativasRejoin.current += 1;
      try {
        // The server accepts a rejoin into a started lobby; `left_at` is cleared there.
        await api.joinLobby(partyId);
      } catch {
        if (alive) setError(ERRO_REENTRADA);
        return;
      }
      if (!alive) return;
      setError(null);
      tentativasSse = 0;
      void connect();
    };

    const connect = async () => {
      let ticket: string;
      try {
        // EventSource cannot send the Privy bearer, so each connection exchanges it for a short-lived server ticket.
        ({ ticket } = await api.sseTicket(roomId, partyId, 'lobby'));
      } catch (e) {
        const status = e instanceof ApiError ? e.status : null;
        await falhou(status, e instanceof Error ? e.message : 'sem sessão verificada');
        return;
      }
      if (!alive) return;
      source = new EventSource(url(ticket));
      source.onmessage = (event) => {
        if (!alive) return;
        const next = JSON.parse(event.data) as LobbyState;
        if (next.type === 'lobby_state') {
          setState(next);
          setError(null);
          // A delivered packet proves the connection is healthy; reset the backoff.
          tentativasSse = 0;
        }
      };
      source.onerror = () => {
        source?.close();
        source = null;
        if (!alive) return;
        void statusDaRecusa().then((status) =>
          falhou(status, 'conexão com a sala caiu, tentando de novo'),
        );
      };
    };

    void connect();
    return () => {
      alive = false;
      if (retry) clearTimeout(retry);
      source?.close();
    };
  }, [roomId, partyId, active, privyAuthenticated]);

  const toggleReady = useCallback(async () => {
    if (!state || sending) return;
    setSending(true);
    try {
      await api.lobbyReady(roomId, partyId, !state.meReady);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'não deu para atualizar o lobby');
    } finally {
      setSending(false);
    }
  }, [roomId, partyId, sending, state]);

  const start = useCallback(async () => {
    if (sending) return;
    setSending(true);
    try {
      await api.lobbyStart(roomId, partyId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'não deu para iniciar a partida');
    } finally {
      setSending(false);
    }
  }, [roomId, partyId, sending]);

  const leave = useCallback(async () => {
    await api.lobbyLeave(roomId, partyId);
  }, [roomId, partyId]);

  const finish = useCallback(async () => {
    await api.lobbyFinish(roomId, partyId);
  }, [roomId, partyId]);

  return { state, error, sending, toggleReady, start, leave, finish };
}
