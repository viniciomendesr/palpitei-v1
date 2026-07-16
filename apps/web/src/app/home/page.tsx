'use client';

/**
 * HOME — abas Ao Vivo / Próximos / Replays, missão do dia e ligas privadas.
 *
 * A aba Replays é a que precisa de cuidado quando o dado real entrar: replay
 * sintético é dev-only e NUNCA vai pra demo/submissão (regra da trilha). Cada
 * sala mostra selo de origem; a fonte primária é sempre a TxLINE.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SegTabs, MatchCard, Card, ProgressBar, Button, Chip, Badge } from '@/components/ds';
import { Screen } from '@/components/Shell';
import { Logo, Wordmark } from '@/components/Brand';
import { ChevronRight, Crown } from '@/components/Icons';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { useRequireSession } from '@/lib/guard';
import { fw } from '@/lib/tokens';
import { fixtures } from '@/lib/mock';

type Tab = 'live' | 'next' | 'replays';

export default function HomePage() {
  const router = useRouter();
  const { t, fmt } = useI18n();
  const { session, update } = useSession();
  const ready = useRequireSession();
  const [tab, setTab] = useState<Tab>('live');

  if (!ready || !session) return null;

  const fx = fixtures(t);
  const openSala = (id: string) => router.push(`/sala/${id}`);

  // A missão do dia acompanha a sequência de acertos: 3 seguidos fecham.
  const missionDone = Math.min(session.streak, 3);
  const missionPct = (missionDone / 3) * 100;

  const leaguesLabel = session.isPremium
    ? `${session.leaguesCount} · ${t.leaguesUnlimited}`
    : `${session.leaguesCount} ${t.leaguesCountFree}`;

  // O free inclui 1 liga. Da segunda em diante, o gate leva ao paywall.
  const showEmptyLeague = session.accountType === 'new' && session.leaguesCount === 0;
  const showLeagueGate = !session.isPremium && session.leaguesCount >= 1;

  const tryCreateLeague = () => {
    if (session.isPremium || session.leaguesCount < 1) {
      update({ leaguesCount: session.leaguesCount + 1 });
    } else {
      router.push('/premium');
    }
  };

  const leagues = Array.from({ length: session.leaguesCount }, (_, i) =>
    i === 0
      ? { initials: 'ML', name: t.myLeague, sub: t.myLeagueSub }
      : { initials: `L${i + 1}`, name: `${t.myLeague} ${i + 1}`, sub: t.myLeagueSub },
  );

  return (
    <Screen padding="6px 18px 20px">
      {/* cabeçalho: marca · sequência · nível+XP */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <Logo size={34} />
          <Wordmark size={19} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Chip>
            <span
              style={{
                display: 'inline-flex',
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: 'var(--orange)',
                boxShadow: '0 0 8px var(--orange)',
              }}
            />
            <span style={{ fontWeight: fw.heavy }}>{session.streak}</span>
          </Chip>
          <Chip>
            <Badge tone="solid">
              {t.lv} {session.level}
            </Badge>
            <span style={{ fontWeight: fw.heavy }}>{fmt(session.xp)}</span>
          </Chip>
        </div>
      </div>

      <SegTabs
        tabs={[
          { label: t.tabLive, value: 'live' },
          { label: t.tabNext, value: 'next' },
          { label: t.tabReplays, value: 'replays' },
        ]}
        value={tab}
        onChange={(v) => setTab(v as Tab)}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
        {fx[tab].map((f) => (
          <MatchCard
            key={f.id}
            live={f.live}
            status={f.status}
            group={f.group}
            teamA={f.teamA}
            teamB={f.teamB}
            scoreA={f.scoreA}
            scoreB={f.scoreB}
            cta={f.cta}
            onClick={() => openSala(f.id)}
          />
        ))}
      </div>

      {tab === 'replays' && (
        <div
          style={{
            textAlign: 'center',
            fontSize: 12.5,
            color: 'var(--text-muted)',
            fontWeight: fw.medium,
            padding: 12,
          }}
        >
          {t.replaysNote}
        </div>
      )}

      {/* missão do dia + ligas: só na aba Ao Vivo, como no protótipo */}
      {tab === 'live' && (
        <>
          <Card elevated style={{ marginTop: 'var(--sp-5)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ fontWeight: fw.black, fontSize: 10.5, letterSpacing: 1, color: 'var(--lime)' }}>
                {t.missionToday}
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 11,
                  fontWeight: fw.heavy,
                  color: 'var(--orange)',
                }}
              >
                <span
                  style={{ display: 'inline-flex', width: 6, height: 6, borderRadius: '50%', background: 'var(--orange)' }}
                />
                {t.streakLbl}: {session.streak}
              </span>
            </div>
            <div style={{ fontWeight: fw.heavy, fontSize: 17, marginTop: 8 }}>{t.mission1}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
              <div style={{ flex: 1 }}>
                <ProgressBar value={missionPct} />
              </div>
              <span style={{ fontSize: 12, fontWeight: fw.heavy, color: 'var(--text-2)' }}>{missionDone}/3</span>
            </div>
          </Card>

          <div style={{ marginTop: 16 }}>
            <div
              style={{
                fontSize: 10.5,
                fontWeight: fw.black,
                letterSpacing: 1,
                color: 'var(--text-faint)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>{t.leaguesTitle}</span>
              <span style={{ color: 'var(--text-muted)', fontWeight: fw.bold }}>{leaguesLabel}</span>
            </div>

            {leagues.map((lg) => (
              <div
                key={lg.name}
                style={{
                  marginTop: 10,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 13,
                  padding: 14,
                  background: 'var(--surface-1)',
                  border: '1px solid var(--border-1)',
                  borderRadius: 'var(--r-2xl)',
                }}
              >
                <div
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 'var(--r-lg)',
                    background: 'var(--lime-a14)',
                    border: '1px solid var(--lime-line)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: fw.black,
                    fontStyle: 'italic',
                    color: 'var(--lime)',
                    fontSize: 15,
                  }}
                >
                  {lg.initials}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: fw.heavy, fontSize: 15 }}>{lg.name}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: fw.medium }}>{lg.sub}</div>
                </div>
                <ChevronRight />
              </div>
            ))}

            {showEmptyLeague && (
              <div
                style={{
                  marginTop: 10,
                  padding: 18,
                  background: 'linear-gradient(160deg, var(--lime-a10), var(--surface-1))',
                  border: '1.5px dashed var(--lime-line)',
                  borderRadius: 'var(--r-2xl)',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontWeight: fw.heavy, fontSize: 15.5 }}>{t.newLeagueLead}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: fw.medium, marginTop: 3 }}>
                  {t.newLeagueSub}
                </div>
                <div style={{ marginTop: 13 }}>
                  <Button onClick={tryCreateLeague}>{t.createLeague}</Button>
                </div>
              </div>
            )}

            {showLeagueGate && (
              <button
                onClick={tryCreateLeague}
                style={{
                  all: 'unset',
                  cursor: 'pointer',
                  boxSizing: 'border-box',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 13,
                  width: '100%',
                  marginTop: 10,
                  padding: '15px 16px',
                  background: 'linear-gradient(135deg, var(--lime-a14), var(--surface-1))',
                  border: '1.5px solid var(--lime-line)',
                  borderRadius: 'var(--r-2xl)',
                }}
              >
                <div
                  style={{
                    flex: 'none',
                    width: 40,
                    height: 40,
                    borderRadius: 'var(--r-lg)',
                    background: 'var(--lime)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Crown />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: fw.heavy, fontSize: 14.5 }}>{t.createAnother}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: fw.medium }}>
                    {t.leagueGateSub}
                  </div>
                </div>
                <span
                  style={{
                    flex: 'none',
                    fontSize: 10,
                    fontWeight: fw.black,
                    letterSpacing: 0.5,
                    color: 'var(--on-lime)',
                    background: 'var(--lime)',
                    padding: '4px 9px',
                    borderRadius: 'var(--r-pill)',
                  }}
                >
                  {t.pxPremium}
                </span>
              </button>
            )}
          </div>
        </>
      )}
    </Screen>
  );
}
