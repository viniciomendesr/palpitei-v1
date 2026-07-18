'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type LobbyState } from '@/lib/api';

export function useLobby(roomId: string, partyId: string, active: boolean) {
  const [state, setState] = useState<LobbyState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!active || !partyId) return;
    let alive = true;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = async () => {
      let ticket: string;
      try {
        // EventSource cannot send the Privy bearer, so each connection exchanges it for a short-lived server ticket.
        ({ ticket } = await api.sseTicket(roomId, partyId, 'lobby'));
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : 'sem sessão verificada');
        retry = setTimeout(connect, 1_000);
        return;
      }
      if (!alive) return;
      source = new EventSource(
        `/api/rooms/${encodeURIComponent(roomId)}/lobby?party=${encodeURIComponent(partyId)}&ticket=${encodeURIComponent(ticket)}`,
      );
      source.onmessage = (event) => {
        if (!alive) return;
        const next = JSON.parse(event.data) as LobbyState;
        if (next.type === 'lobby_state') {
          setState(next);
          setError(null);
        }
      };
      source.onerror = () => {
        source?.close();
        source = null;
        if (alive) retry = setTimeout(connect, 1_000);
      };
    };

    void connect();
    return () => {
      alive = false;
      if (retry) clearTimeout(retry);
      source?.close();
    };
  }, [roomId, partyId, active]);

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
