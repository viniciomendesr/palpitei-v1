'use client';


import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SegTabs, MatchCard, Card, ProgressBar, Button, Chip, Badge } from '@/components/ds';
import { Screen } from '@/components/Shell';
import { Logo, Wordmark } from '@/components/Brand';
import { ChevronRight, Crown } from '@/components/Icons';
import { useI18n, fill } from '@/lib/i18n';
import { useSession, initialsOf } from '@/lib/session';
import { useRequireSession } from '@/lib/guard';
import { fw } from '@/lib/tokens';
import { fixtures, type FixtureView } from '@/lib/mock';
import { api, type ApiFixture, type ApiLeagues } from '@/lib/api';
import type { SessionState } from '@/lib/session';
import type { Dict } from '@/lib/i18n';
import { usePrivyAuth } from '@/components/privy/PrivyIsland';
import { localizeTeamName } from '@/lib/team-names';

type Tab = 'live' | 'next' | 'replays';

function abaDa(f: ApiFixture): Tab {
  if (f.live) return 'live';
  return f.source === 'txline' ? 'next' : 'replays';
}

function useFixtures(session: SessionState | null, t: Dict) {
  const [reais, setReais] = useState<ApiFixture[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const privy = usePrivyAuth();
  const ehDemo = !session || session.authMethod === 'demo';
  const podeBuscar = !ehDemo && privy.ready && privy.authenticated;

  useEffect(() => {
    if (!podeBuscar) return;
    let vivo = true;
    api
      .fixtures()
      .then((r) => vivo && setReais(r.fixtures))
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : 'não deu para carregar as partidas'));
    return () => {
      vivo = false;
    };
  }, [podeBuscar]);

  if (ehDemo) return { abas: fixtures(t), carregando: false, erro: null };

  const abas: Record<Tab, FixtureView[]> = { live: [], next: [], replays: [] };
  for (const f of reais ?? []) {
    abas[abaDa(f)].push({
      id: f.id,
      live: f.live,
      status: f.status,
      group: f.group,
      teamA: f.teamA,
      teamB: f.teamB,
      scoreA: f.scoreA ?? '–',
      scoreB: f.scoreB ?? '–',
      cta: f.live ? t.ctaEnter : f.source === 'txline' ? t.ctaRemind : f.training ? t.ctaTreino : t.ctaReplay,
      source: f.source === 'txline' ? t.srcTxline : f.training ? t.srcTreino : t.srcReplay,
    });
  }
  return { abas, carregando: reais === null && !erro, erro };
}

type LigaView = { id: string | null; initials: string; name: string; sub: string };

function useLeagues(session: SessionState | null, t: Dict) {
  const [dados, setDados] = useState<ApiLeagues | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const privy = usePrivyAuth();
  const ehDemo = !session || session.authMethod === 'demo';
  const podeBuscar = !ehDemo && privy.ready && privy.authenticated;

  useEffect(() => {
    if (!podeBuscar) return;
    let vivo = true;
    api
      .leagues()
      .then((r) => vivo && setDados(r))
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : t.ligaErro));
    return () => {
      vivo = false;
    };
  }, [podeBuscar, t.ligaErro]);

  const membros = (n: number) => (n === 1 ? t.ligaMembroUm : fill(t.ligaMembros, { n }));

  if (ehDemo) {
    const ligas: LigaView[] = Array.from({ length: session?.leaguesCount ?? 0 }, (_, i) => ({
      id: null,
      initials: 'ML',
      name: i === 0 ? t.myLeague : `${t.myLeague} ${i + 1}`,
      sub: t.myLeagueSub,
    }));
    return {
      ligas,
      ownedCount: session?.leaguesCount ?? 0,
      freeLimit: 1,
      isPremium: session?.isPremium ?? false,
      carregando: false,
      erro: null,
    };
  }

  const ligas: LigaView[] = (dados?.leagues ?? []).map((l) => ({
    id: l.id,
    initials: initialsOf(l.name, 'existing'),
    name: l.name,
    sub: l.iLead ? `${membros(l.memberCount)} · ${t.ligaVoceLidera}` : membros(l.memberCount),
  }));

  return {
    ligas,
    ownedCount: dados?.ownedCount ?? 0,
    freeLimit: dados?.freeLimit ?? 1,
    isPremium: dados?.isPremium ?? false,
    carregando: dados === null && !erro,
    erro,
  };
}

export default function HomePage() {
  const router = useRouter();
  const { t, fmt, lang } = useI18n();
  const { session, update, refreshState } = useSession();
  const ready = useRequireSession();
  const [tab, setTab] = useState<Tab>('live');
  const ehDemo = session?.authMethod === 'demo';

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  useEffect(() => {
    if (ehDemo) setTab('next');
  }, [ehDemo]);

  const { abas, carregando, erro } = useFixtures(session, t);
  const liga = useLeagues(session, t);

  if (!ready || !session) return null;

  const openSala = (id: string) => router.push(`/sala/${id}`);

  const missionDone = Math.min(session.streak, 3);
  const missionPct = (missionDone / 3) * 100;

  const leaguesLabel = liga.isPremium
    ? `${liga.ownedCount} · ${t.leaguesUnlimited}`
    : `${liga.ownedCount} ${t.leaguesCountFree}`;

  const podeCriar = liga.isPremium || liga.ownedCount < liga.freeLimit;
  const semLigas = !liga.carregando && !liga.erro && liga.ligas.length === 0;

  const tryCreateLeague = () => {
    if (ehDemo) {
      if (podeCriar) update({ leaguesCount: session.leaguesCount + 1 });
      else router.push('/premium');
      return;
    }
    router.push(podeCriar ? '/liga/nova' : '/premium');
  };

  return (
    <Screen padding="6px 18px 20px">
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

      {!ehDemo && (
        <Button full variant="secondary" onClick={() => router.push('/lobby/entrar')} style={{ marginTop: 12 }}>
          {t.lobbyHomeCta}
        </Button>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
        {abas[tab].map((f) => (
          <MatchCard
            key={f.id}
            live={f.live}
            status={f.status}
            group={`${f.group} · ${f.source}`}
            teamA={localizeTeamName(f.teamA, lang)}
            teamB={localizeTeamName(f.teamB, lang)}
            scoreA={f.scoreA}
            scoreB={f.scoreB}
            cta={tab === 'next' ? t.ctaPalpitar : f.cta}
            onClick={tab === 'next' ? () => router.push(`/palpite/${f.id}`) : () => openSala(f.id)}
          />
        ))}

        {!abas[tab].length && (
          <div
            style={{
              textAlign: 'center',
              padding: '28px 12px',
              fontSize: 13,
              fontWeight: fw.medium,
              lineHeight: 'var(--leading-body)',
              color: erro ? 'var(--red)' : 'var(--text-muted)',
            }}
            role={erro ? 'alert' : undefined}
          >
            {carregando ? t.fxLoading : erro ? `${t.fxError} ${erro}` : t.fxEmpty}
          </div>
        )}
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

            {(liga.carregando || liga.erro) && (
              <div
                style={{
                  marginTop: 10,
                  padding: '18px 12px',
                  textAlign: 'center',
                  fontSize: 13,
                  fontWeight: fw.medium,
                  color: liga.erro ? 'var(--red)' : 'var(--text-muted)',
                }}
                role={liga.erro ? 'alert' : undefined}
              >
                {liga.erro ? `${t.ligaErro} ${liga.erro}` : t.ligaCarregando}
              </div>
            )}

            {liga.ligas.map((lg) => (
              <div
                key={lg.id ?? lg.name}
                onClick={lg.id ? () => router.push(`/liga/${lg.id}`) : undefined}
                style={{
                  marginTop: 10,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 13,
                  padding: 14,
                  background: 'var(--surface-1)',
                  border: '1px solid var(--border-1)',
                  borderRadius: 'var(--r-2xl)',
                  cursor: lg.id ? 'pointer' : 'default',
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

            {semLigas && (
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

            {liga.ligas.length > 0 && podeCriar && (
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
                  background: 'var(--surface-1)',
                  border: '1.5px dashed var(--lime-line)',
                  borderRadius: 'var(--r-2xl)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: fw.heavy, fontSize: 14.5 }}>{t.createAnother}</div>
                </div>
                <ChevronRight />
              </button>
            )}

            {liga.ligas.length > 0 && !podeCriar && (
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

            {!ehDemo && (
              <button
                onClick={() => router.push('/liga/entrar')}
                style={{
                  all: 'unset',
                  boxSizing: 'border-box',
                  cursor: 'pointer',
                  display: 'block',
                  width: '100%',
                  marginTop: 12,
                  textAlign: 'center',
                  fontSize: 12.5,
                  fontWeight: fw.bold,
                  color: 'var(--lime)',
                }}
              >
                {t.entrarLigaLead}
              </button>
            )}
          </div>
        </>
      )}
    </Screen>
  );
}
