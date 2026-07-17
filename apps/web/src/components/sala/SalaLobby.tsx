'use client';

import { useEffect, useMemo, useState } from 'react';
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

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newPartyId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((n) => ALPHABET[n % ALPHABET.length]).join('');
}

export function SalaComLobby({ roomId }: { roomId: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const privy = usePrivyAuth();
  const { session } = useSession();
  const [partyId, setPartyId] = useState(() => {
    const value = search.get('party')?.toUpperCase() ?? '';
    return /^[A-Z0-9]{6,12}$/.test(value) ? value : '';
  });

  useEffect(() => {
    if (partyId) return;
    const generated = newPartyId();
    setPartyId(generated);
    router.replace(`/sala/${encodeURIComponent(roomId)}?party=${generated}`, { scroll: false });
  }, [partyId, roomId, router]);

  const active = Boolean(partyId && session && privy.ready && privy.authenticated);
  const lobby = useLobby(roomId, partyId, active);

  if (lobby.state?.phase === 'started') {
    return (
      <SalaReal
        fixtureId={roomId}
        partyId={partyId}
        lobbyPlayerCount={lobby.state.players.length}
      />
    );
  }

  return <LobbyView roomId={roomId} partyId={partyId} {...lobby} />;
}

function LobbyView({
  partyId,
  state,
  error,
  sending,
  toggleReady,
  start,
}: {
  roomId: string;
  partyId: string;
  state: ReturnType<typeof useLobby>['state'];
  error: string | null;
  sending: boolean;
  toggleReady: () => Promise<void>;
  start: () => Promise<void>;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const allReady = useMemo(
    () => Boolean(state?.players.length && state.players.every((player) => player.ready)),
    [state?.players],
  );

  const copyInvite = async () => {
    await navigator.clipboard.writeText(window.location.href);
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
        <Badge tone="neutral">{state?.treino ? t.treinoTag : t.replayShort}</Badge>
        <h1 style={{ margin: '14px 0 0', fontSize: 24, fontWeight: fw.black }}>{t.lobbyTitle}</h1>
        <p style={{ margin: '8px auto 0', maxWidth: 310, color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5 }}>
          {t.lobbyBody}
        </p>
        {state && (
          <div style={{ marginTop: 18, fontSize: 18, fontWeight: fw.black }}>
            {state.teamA} <span style={{ color: 'var(--text-muted)' }}>×</span> {state.teamB}
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

      {error && <p role="alert" style={{ color: 'var(--red)', textAlign: 'center', fontSize: 12 }}>{error}</p>}
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
