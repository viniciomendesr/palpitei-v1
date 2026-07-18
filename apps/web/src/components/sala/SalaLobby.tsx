'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Badge, Button } from '@/components/ds';
import { Screen } from '@/components/Shell';
import { Check, ChevronLeft } from '@/components/Icons';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { useLobby } from '@/lib/useLobby';
import { usePrivyAuth } from '@/components/privy/PrivyIsland';
import { fw } from '@/lib/tokens';
import { SalaReal } from './SalaReal';
import { localizeTeamName } from '@/lib/team-names';

export function SalaComLobby({ roomId }: { roomId: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const privy = usePrivyAuth();
  const { session } = useSession();
  const [partyId, setPartyId] = useState(() => {
    const value = search.get('party')?.toUpperCase() ?? '';
    return /^[A-Z0-9]{6,12}$/.test(value) ? value : '';
  });
  const [createError, setCreateError] = useState<string | null>(null);
  const creating = useRef(false);
  const entrouNaPartida = useRef(false);

  useEffect(() => {
    if (partyId || !session || !privy.ready || !privy.authenticated || creating.current) return;
    creating.current = true;
    void import('@/lib/api').then(({ api }) => api.createLobby(roomId)).then(({ lobby }) => {
      setPartyId(lobby.inviteCode);
      router.replace(`/sala/${encodeURIComponent(roomId)}?party=${encodeURIComponent(lobby.inviteCode)}`, { scroll: false });
    }).catch((error) => {
      creating.current = false;
      setCreateError(error instanceof Error ? error.message : 'não deu para criar o lobby');
    });
  }, [partyId, roomId, router, session, privy.ready, privy.authenticated]);

  const active = Boolean(partyId && session && privy.ready && privy.authenticated);
  const lobby = useLobby(roomId, partyId, active, privy.authenticated);

  if (lobby.state?.phase === 'started') entrouNaPartida.current = true;

  if (lobby.state?.phase === 'finished' && !entrouNaPartida.current) {
    return <LobbyFinishedView />;
  }

  if (lobby.state?.phase === 'started' || lobby.state?.phase === 'finished') {
    return (
      <SalaReal
        fixtureId={roomId}
        partyId={partyId}
        lobbyPlayerCount={lobby.state.players.length}
        lobbyPlayers={lobby.state.players}
        onLeaveLobby={lobby.leave}
      />
    );
  }

  return <LobbyView roomId={roomId} partyId={partyId} createError={createError} {...lobby} />;
}

function LobbyFinishedView() {
  const router = useRouter();
  const { t } = useI18n();
  return (
    <Screen padding="24px 22px" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: 'center' }}>
      <Badge tone="neutral">{t.lanceEnd}</Badge>
      <h1 style={{ margin: '18px 0 0', fontSize: 25, fontWeight: fw.black }}>{t.lobbyFinishedTitle}</h1>
      <p style={{ margin: '10px auto 22px', maxWidth: 320, color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.55 }}>
        {t.lobbyFinishedBody}
      </p>
      <Button full size="lg" onClick={() => router.replace('/home')}>{t.backHome}</Button>
    </Screen>
  );
}

function LobbyView({
  partyId,
  state,
  error,
  sending,
  createError,
  toggleReady,
  start,
}: {
  roomId: string;
  partyId: string;
  state: ReturnType<typeof useLobby>['state'];
  error: string | null;
  sending: boolean;
  createError: string | null;
  toggleReady: () => Promise<void>;
  start: () => Promise<void>;
}) {
  const router = useRouter();
  const { t, lang } = useI18n();
  const [copied, setCopied] = useState(false);
  const allReady = useMemo(
    () => Boolean(state?.players.length && state.players.every((player) => player.ready)),
    [state?.players],
  );

  const copyInvite = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}/convite/${encodeURIComponent(partyId)}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1_800);
  };

  return (
    <Screen padding="18px 20px 24px" style={{ display: 'flex', flexDirection: 'column' }}>
      <button
        onClick={() => router.push('/home')}
        aria-label={t.backHome}
        style={{
          all: 'unset',
          cursor: 'pointer',
          width: 38,
          height: 38,
          borderRadius: 'var(--r-lg)',
          background: 'var(--surface-1)',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <ChevronLeft />
      </button>

      <div style={{ textAlign: 'center', marginTop: 22 }}>
        <Badge tone="neutral">{state?.training ? t.treinoTag : t.replayShort}</Badge>
        <h1 style={{ margin: '14px 0 0', fontSize: 24, fontWeight: fw.black }}>{t.lobbyTitle}</h1>
        <p style={{ margin: '8px auto 0', maxWidth: 310, color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5 }}>
          {t.lobbyBody}
        </p>
        {state && (
          <div style={{ marginTop: 18, fontSize: 18, fontWeight: fw.black }}>
            {localizeTeamName(state.teamA, lang)} <span style={{ color: 'var(--text-muted)' }}>×</span>{' '}
            {localizeTeamName(state.teamB, lang)}
          </div>
        )}
      </div>

      <div
        style={{
          marginTop: 22,
          padding: '14px 16px',
          borderRadius: 'var(--r-2xl)',
          background: 'var(--surface-1)',
          border: '1px solid var(--border-2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 9.5, fontWeight: fw.black, letterSpacing: 1, color: 'var(--text-muted)' }}>
            {t.lobbyCode}
          </div>
          <div style={{ marginTop: 3, fontSize: 22, fontWeight: fw.black, letterSpacing: 3, color: 'var(--lime)' }}>
            {partyId || '------'}
          </div>
        </div>
        <Button variant="secondary" onClick={() => void copyInvite()} disabled={!partyId}>
          {copied ? t.lobbyCopied : t.lobbyCopy}
        </Button>
      </div>

      <div style={{ marginTop: 24, fontSize: 10, fontWeight: fw.black, letterSpacing: 1, color: 'var(--text-muted)' }}>
        {t.lobbyPlayers} · {state?.players.length ?? 0}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 9 }}>
        {(state?.players ?? []).map((player, index) => (
          <div
            key={`${player.name}-${player.host ? 'host' : 'guest'}-${index}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 11,
              padding: '12px 14px',
              borderRadius: 'var(--r-xl)',
              background: 'var(--surface-1)',
              border: `1px solid ${player.ready ? 'var(--lime-line)' : 'var(--border-1)'}`,
            }}
          >
            <span
              style={{
                width: 30,
                height: 30,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                background: player.ready ? 'var(--lime)' : 'var(--surface-2)',
                color: player.ready ? 'var(--on-lime)' : 'var(--text-muted)',
                fontWeight: fw.black,
              }}
            >
              {player.ready ? <Check color="var(--on-lime)" /> : player.name.slice(0, 1).toUpperCase()}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: fw.heavy }}>{player.name}</div>
              <div style={{ marginTop: 2, fontSize: 10.5, color: 'var(--text-muted)' }}>
                {player.host ? `${t.lobbyHost} · ` : ''}{player.ready ? t.lobbyReady : t.lobbyWaiting}
              </div>
            </div>
          </div>
        ))}
      </div>

      {(error || createError) && <p role="alert" style={{ color: 'var(--red)', textAlign: 'center', fontSize: 12 }}>{error || createError}</p>}
      <div style={{ flex: 1, minHeight: 22 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <Button full size="lg" variant={state?.meReady ? 'secondary' : 'primary'} disabled={!state || sending} onClick={() => void toggleReady()}>
          {state?.meReady ? t.lobbyNotReady : t.lobbyMarkReady}
        </Button>
        {state?.meHost ? (
          <Button full size="lg" disabled={!allReady || sending} onClick={() => void start()}>
            {t.lobbyStart}
          </Button>
        ) : (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 11.5 }}>{t.lobbyWaitHost}</p>
        )}
        {state?.meHost && !allReady && (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 11.5, margin: 0 }}>{t.lobbyNeedReady}</p>
        )}
      </div>
    </Screen>
  );
}
