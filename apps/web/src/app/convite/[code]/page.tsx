'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Card } from '@/components/ds';
import { Screen } from '@/components/Shell';
import { Logo } from '@/components/Brand';
import { api, type ApiLobbyPreview } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { localizeTeamName } from '@/lib/team-names';
import { setPendingReturnTo } from '@/lib/return-to';
import { fw } from '@/lib/tokens';

export default function ConvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = use(params);
  const code = rawCode.replace(/[\s-]/g, '').toUpperCase();
  const router = useRouter();
  const { t, lang } = useI18n();
  const { session, hydrated } = useSession();
  const [lobby, setLobby] = useState<ApiLobbyPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    let alive = true;
    api.previewLobby(code)
      .then(({ lobby: preview }) => alive && setLobby(preview))
      .catch((e) => alive && setError(e instanceof Error ? e.message : t.lobbyInviteInvalid));
    return () => { alive = false; };
  }, [code, t.lobbyInviteInvalid]);

  const login = () => {
    setPendingReturnTo(`/convite/${encodeURIComponent(code)}`);
    router.push('/');
  };

  const join = async () => {
    if (!session || session.authMethod === 'demo') return login();
    setJoining(true);
    setError(null);
    try {
      const { lobby: joined } = await api.joinLobby(code);
      router.replace(`/sala/${encodeURIComponent(joined.roomId)}?party=${encodeURIComponent(joined.inviteCode)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.lobbyJoinError);
      setJoining(false);
    }
  };

  return (
    <Screen padding="24px 22px" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <Logo size={58} />
        <div style={{ marginTop: 22 }}><Badge tone="neutral">{lobby?.treino ? t.treinoTag : t.replayShort}</Badge></div>
        <h1 style={{ margin: '16px 0 0', fontSize: 26, fontWeight: fw.black }}>{t.lobbyInviteTitle}</h1>
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>{t.lobbyInviteBody}</p>
      </div>
      <Card elevated style={{ marginTop: 20, textAlign: 'center' }}>
        {lobby ? (
          <>
            <div style={{ fontSize: 20, fontWeight: fw.black }}>
              {localizeTeamName(lobby.teamA, lang)} × {localizeTeamName(lobby.teamB, lang)}
            </div>
            <div style={{ marginTop: 10, color: 'var(--text-muted)', fontSize: 13 }}>
              {lobby.memberCount}/{lobby.maxPlayers} · {code}
            </div>
          </>
        ) : !error ? <p>{t.salaLoading}</p> : null}
        {error && <p role="alert" style={{ color: 'var(--red)' }}>{error}</p>}
      </Card>
      <div style={{ marginTop: 18 }}>
        <Button full size="lg" disabled={!lobby || !hydrated || joining} onClick={() => void join()}>
          {!hydrated ? t.salaLoading : joining ? t.lobbyJoining : session && session.authMethod !== 'demo' ? t.lobbyJoin : t.lobbyLoginToJoin}
        </Button>
      </div>
    </Screen>
  );
}
