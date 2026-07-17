'use client';

/**
 * HOME — abas Ao Vivo / Próximos / Replays, missão do dia e ligas privadas.
 *
 * A aba Replays é a que precisa de cuidado quando o dado real entrar: replay
 * sintético é dev-only e NUNCA vai pra demo/submissão (regra da trilha). Cada
 * sala mostra selo de origem; a fonte primária é sempre a TxLINE.
 */

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

type Tab = 'live' | 'next' | 'replays';

/** Aba onde cada partida real entra. Sem bola rolando, `live` vem false do servidor. */
function abaDa(f: ApiFixture): Tab {
  if (f.live) return 'live';
  return f.source === 'txline' ? 'next' : 'replays';
}

/**
 * O dado da home, e é aqui que mora a regra do produto:
 *
 *   demo (§5.1)       → mock, rotulado SIMULADO. Não chama a rota, não precisa
 *                       de rede: é o caminho do jurado e ele não pode depender
 *                       de nada.
 *   Google / carteira → só TxLINE real, via GET /api/fixtures (Bearer verificado).
 *
 * O fã logado NUNCA cai no mock: se a rota falhar, ele vê a lista vazia com o
 * erro, não Argentina × Cabo Verde inventado. Fallback silencioso para o mock é
 * o G6 — o rótulo passa a mentir sobre a origem — e é justamente o que a §2
 * proíbe ao exigir selo de fonte.
 */
function useFixtures(session: SessionState | null, t: Dict) {
  const [reais, setReais] = useState<ApiFixture[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const privy = usePrivyAuth();
  const ehDemo = !session || session.authMethod === 'demo';
  // A sessão local revive do sessionStorage NA HORA; a Privy leva um par de
  // segundos para ficar `ready`. Buscar assim que a sessão aparece é correr
  // contra a ilha: o authTokenProvider ainda devolve null, o Bearer não vai, e a
  // rota responde 401 — que a tela mostrava como "sem sessão verificada" para um
  // fã que está logado. Esperar o `ready` é o que faz o Bearer existir.
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
      // O servidor manda null quando a partida não começou. Ausente NÃO é zero
      // (A4): renderizar 0 aqui afirma um empate que ninguém jogou.
      scoreA: f.scoreA ?? '–',
      scoreB: f.scoreB ?? '–',
      cta: f.live ? t.ctaEnter : f.source === 'txline' ? t.ctaRemind : f.treino ? t.ctaTreino : t.ctaReplay,
      // O selo diz o que o servidor gravou, não o que seria bonito. TREINO
      // entra no selo: sala que não paga XP não pode se vestir de sala que paga.
      source: f.source === 'txline' ? t.srcTxline : f.treino ? t.srcTreino : t.srcReplay,
    });
  }
  return { abas, carregando: reais === null && !erro, erro };
}

/** Como uma liga aparece na lista. `id` null = a liga mock do demo, que não abre. */
type LigaView = { id: string | null; initials: string; name: string; sub: string };

/**
 * As ligas da home — o mesmo desenho do `useFixtures` acima, e pela mesma razão:
 *
 *   demo (§5.1)       → mock LOCAL. Não chama rota, não precisa de rede: é o
 *                       caminho do jurado, e ele não pode depender de nada.
 *   Google / carteira → só o banco, via GET /api/leagues (Bearer verificado).
 *
 * O que este hook aposenta: `session.leaguesCount`, um contador que vivia no
 * browser e sumia no F5 — a liga não existia em lugar nenhum do backend. Para o
 * fã logado, o número de membros e o "você lidera" agora vêm da tabela; se a
 * rota falhar, ele vê o erro, não uma liga inventada.
 */
function useLeagues(session: SessionState | null, t: Dict) {
  const [dados, setDados] = useState<ApiLeagues | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const privy = usePrivyAuth();
  const ehDemo = !session || session.authMethod === 'demo';
  // Mesma corrida do useFixtures: a sessão local revive na hora, a Privy leva
  // uns segundos para ficar `ready`. Buscar antes disso é 401 garantido.
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
    // A liga do demo é mock local de 1 membro — e é por isso que `myLeagueSub`
    // ("1 membro · você lidera") pode ser usada aqui: no demo ela é VERDADE.
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
    // O número é o que o banco contou. Sem "+1", sem string fixa.
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
  const { t, fmt } = useI18n();
  const { session, update, refreshState } = useSession();
  const ready = useRequireSession();
  const [tab, setTab] = useState<Tab>('live');

  // O XP/nível do cabeçalho é do BANCO (o motor liquida lá): voltar da sala tem
  // que mostrar o que o jogo acabou de pagar. No demo é no-op (§5.1: local).
  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  const { abas, carregando, erro } = useFixtures(session, t);
  const liga = useLeagues(session, t);

  if (!ready || !session) return null;

  const ehDemo = session.authMethod === 'demo';
  const openSala = (id: string) => router.push(`/sala/${id}`);

  // A missão do dia acompanha a sequência de acertos: 3 seguidos fecham.
  const missionDone = Math.min(session.streak, 3);
  const missionPct = (missionDone / 3) * 100;

  // O contador conta as ligas CRIADAS, que é o que a cota do free mede. Somar as
  // ligas em que o fã só entrou faria a tela dizer "3 de 1 grátis" para quem não
  // furou cota nenhuma.
  const leaguesLabel = liga.isPremium
    ? `${liga.ownedCount} · ${t.leaguesUnlimited}`
    : `${liga.ownedCount} ${t.leaguesCountFree}`;

  const podeCriar = liga.isPremium || liga.ownedCount < liga.freeLimit;
  const semLigas = !liga.carregando && !liga.erro && liga.ligas.length === 0;

  const tryCreateLeague = () => {
    // O demo não fala com rota nenhuma (§5.1): a liga dele continua sendo o
    // contador local do protótipo.
    if (ehDemo) {
      if (podeCriar) update({ leaguesCount: session.leaguesCount + 1 });
      else router.push('/premium');
      return;
    }
    // O gate aqui é só cortesia — quem manda é o servidor, sob trava. Isto
    // existe para não levar o fã a um 402 evitável.
    router.push(podeCriar ? '/liga/nova' : '/premium');
  };

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
        {abas[tab].map((f) => (
          <MatchCard
            key={f.id}
            live={f.live}
            status={f.status}
            group={`${f.group} · ${f.source}`}
            teamA={f.teamA}
            teamB={f.teamB}
            scoreA={f.scoreA}
            scoreB={f.scoreB}
            cta={f.cta}
            onClick={() => openSala(f.id)}
          />
        ))}

        {/* Lista vazia sem explicação é a falha silenciosa que este projeto
            existe para evitar: o fã logado tem que saber se está carregando, se
            deu erro, ou se a TxLINE simplesmente não tem partida nesta aba. */}
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

            {/* Carregando/erro ditos em voz alta: lista de liga vazia sem
                explicação é a mesma falha silenciosa das partidas — o fã não
                sabe se não tem liga ou se a rota caiu. */}
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

            {/* Já tem liga e AINDA pode criar (premium, ou entrou na liga de um
                amigo sem ter criado a própria). Sem este caso, quem só entrou
                por convite ficava sem nenhum jeito de criar a dele: a lista não
                estava vazia, e o gate do paywall não se aplicava. */}
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

            {/* O outro lado do convite. Sem isto, "chame a galera" seria um
                código que ninguém tem onde digitar. O demo não entra por código:
                a liga dele é local e não existe no banco (§5.1). */}
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
