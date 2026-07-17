'use client';

/**
 * SALA AO VIVO — cabeçalho de placar, abas Lances/Estatísticas/Ranking e o
 * bottom sheet do desafio.
 *
 * Três fases, exatamente como o protótipo (lá eram `phase` dentro da rota `sala`,
 * e continuam sendo: são estados da MESMA sala, não páginas — a URL não muda no
 * meio de um desafio, senão o botão "voltar" do browser cai no meio do jogo):
 *
 *   question → o sheet aberto, timer correndo
 *   result   → tela cheia com a leitura do jogo
 *   fim      → fim de jogo
 *
 * ================== O QUE MUDA QUANDO O DADO REAL ENTRAR ==================
 * Hoje o motor é o array CHALLENGES e um setInterval. Na v1:
 *   - `question_open` abre o sheet e traz `closesAt` (ts do EVENTO, via Clock).
 *   - `question_resolved` traz a opção certa e o XP; `question_void` ANULA (sem
 *     XP) quando o lance resolvedor chegou com a janela aberta.
 *   - `score_event` mexe placar/minuto — e Score AUSENTE ≠ zero (A4): sem o
 *     bloco, MANTENHA o placar; zerar dá gol fantasma.
 *   - o POST /api/rooms/:id/predictions registra o palpite. Sem userId no body:
 *     quem responde é quem o Bearer diz que é.
 * =========================================================================
 */

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SegTabs, Badge } from '@/components/ds';
import { Screen } from '@/components/Shell';
import { ChevronLeft, Star } from '@/components/Icons';
import { FlagArgentina, FlagCaboVerde } from '@/components/Flag';
import { ChallengeSheet } from '@/components/sala/ChallengeSheet';
import { ChallengeResult, type LastResult } from '@/components/sala/ChallengeResult';
import { GameEnd } from '@/components/sala/GameEnd';
import { SalaReal } from '@/components/sala/SalaReal';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { useRequireSession } from '@/lib/guard';
import { fw } from '@/lib/tokens';
import {
  CHALLENGES,
  COUNTDOWN_SECONDS,
  MATCH_START,
  ROOM_SIZE,
  feedInit,
  liveStats,
  roomRanking,
  type FeedEvent,
} from '@/lib/mock';
// Confere, em dev, que CHALLENGES e dict.ch descrevem os MESMOS desafios e as
// MESMAS opções. São arrays paralelos: fora de sincronia, esta sala renderiza
// null — tela preta sem erro nenhum (CONTEXT.md §3).
import '@/lib/invariants';

type Phase = 'question' | 'result' | 'fim';
type SalaTab = 'lances' | 'stats' | 'ranking';

/**
 * A bifurcação da sala. Duas máquinas de estado OPOSTAS, e por isso dois
 * componentes:
 *
 *   demo (§5.1)  → SalaMock: o motor mora aqui dentro (`optId === spec.correct`),
 *                  o relógio é um setInterval, e nada depende de rede. É o
 *                  caminho do jurado; é o único que não pode falhar.
 *   partida real → SalaReal: quem abre, fecha e julga é o SERVIDOR, via SSE. A
 *                  tela não decide nada, porque palpite vale XP no ranking
 *                  público e cliente que decide o próprio XP é fraude (§4).
 *
 * O id decide: as partidas reais são fixtureId da TxLINE (numérico); as do mock
 * são apelidos do protótipo ('arg-cab', 'esp-cor'). Sem isto, "Rever partida" no
 * England × Argentina abria Argentina × Cabo Verde — dado inventado com cara de
 * real, que é o G6 que este projeto existe para evitar.
 */
export default function SalaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { session } = useSession();
  const ehDemo = !session || session.authMethod === 'demo';
  // Partida real só existe atrás de login: o demo nunca chama a rota (nem tem
  // Bearer para isso).
  if (!ehDemo && /^\d+$/.test(id)) return <SalaReal fixtureId={id} />;
  return <SalaMock params={params} />;
}

function SalaMock({ params }: { params: Promise<{ id: string }> }) {
  // Next 15: params é uma Promise. `use()` desembrulha no cliente.
  const { id } = use(params);
  const router = useRouter();
  const { t, fmt, lang } = useI18n();
  const { session, update } = useSession();
  const ready = useRequireSession();

  const [phase, setPhase] = useState<Phase>('question');
  const [ci, setCi] = useState(0);
  const [secs, setSecs] = useState(COUNTDOWN_SECONDS);
  const [salaTab, setSalaTab] = useState<SalaTab>('lances');
  const [salaXp, setSalaXp] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [lastResult, setLastResult] = useState<LastResult | null>(null);
  const [feed, setFeed] = useState<FeedEvent[]>(feedInit);
  const [minute, setMinute] = useState<number>(MATCH_START.minute);
  const [scoreA, setScoreA] = useState<number>(MATCH_START.scoreA);
  const [scoreB, setScoreB] = useState<number>(MATCH_START.scoreB);

  const spec = CHALLENGES[ci];
  const text = t.ch[ci];

  /** Fecha o desafio. `optId === null` = tempo esgotado. */
  const resolveChallenge = useCallback(
    (optId: string | null) => {
      // Reentrância: dois toques rápidos (ou o toque no mesmo tick em que o
      // relógio zera) resolveriam o desafio duas vezes e creditariam XP dobrado.
      // O protótipo tinha essa guarda; ela não é opcional.
      if (phase !== 'question') return;
      if (!spec || !session) return;

      const correct = optId === spec.correct;
      const gained = correct ? spec.xp : 0;
      const r = spec.resolve;

      setMinute(r.minute);
      // Ausente ≠ zero (A4): o lance que NÃO mexe no placar (escanteio, chute pra
      // fora) simplesmente omite o campo, e omitido quer dizer "não mudou" — não
      // quer dizer 0. Por isso o teste é `!== undefined` e não um `||`/falsy: um
      // placar de 0 é placar de verdade, e zerar aqui daria gol fantasma.
      if (r.scoreA !== undefined) setScoreA(r.scoreA);
      if (r.scoreB !== undefined) setScoreB(r.scoreB);

      setFeed((f) => [
        { t: `${r.minute}'`, pt: spec.eventPt, en: spec.eventEn },
        ...f,
      ]);

      setSalaXp((x) => x + gained);
      setCorrectCount((c) => c + (correct ? 1 : 0));
      setLastResult({
        correct,
        timeout: optId === null,
        gained,
        correctId: spec.correct,
        final: !!r.final,
      });

      // XP e sequência são do fã, não da sala: sobem pra sessão.
      // Errar ZERA a sequência — é o que dá peso ao acerto seguido.
      update({
        xp: session.xp + gained,
        streak: correct ? session.streak + 1 : 0,
      });

      setPhase('result');
    },
    [phase, spec, session, update],
  );

  // Entrar/sair da sala. Hoje só marca a fronteira; quando o backend existir é
  // aqui que o join/leave e a assinatura do WS /ws acontecem.
  useEffect(() => {
    // TODO: api.joinRoom(id) + abrir o WS da sala; leave no cleanup.
    void id;
  }, [id]);

  // O relógio da janela. Só corre na fase de pergunta.
  useEffect(() => {
    if (phase !== 'question') return;
    const timer = setInterval(() => setSecs((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [phase, ci]);

  // Zerou: resolve como tempo esgotado. Separado do intervalo de propósito —
  // disparar efeito de dentro de um updater de estado não é seguro.
  useEffect(() => {
    if (phase === 'question' && secs === 0) resolveChallenge(null);
  }, [secs, phase, resolveChallenge]);

  const goNext = () => {
    if (lastResult?.final || ci + 1 >= CHALLENGES.length) {
      setPhase('fim');
      return;
    }
    setCi((i) => i + 1);
    setSecs(COUNTDOWN_SECONDS);
    setPhase('question');
  };

  const leave = () => {
    // TODO: POST /api/rooms/:id/leave quando o backend existir.
    router.push('/home');
  };

  const stats = useMemo(() => liveStats(t), [t]);
  const ranking = useMemo(() => roomRanking(t, salaXp), [t, salaXp]);
  const myPos = ranking.find((r) => r.id === 'me')?.pos ?? 2;

  if (!ready || !session) return null;
  if (!spec || !text) return null;

  if (phase === 'fim') {
    return (
      <GameEnd
        scoreA={scoreA}
        scoreB={scoreB}
        salaXp={salaXp}
        correctCount={correctCount}
        total={CHALLENGES.length}
        level={session.level}
        xp={session.xp}
        onShare={() => router.push('/ranking')}
        onHome={leave}
      />
    );
  }

  if (phase === 'result' && lastResult) {
    return (
      <ChallengeResult
        spec={spec}
        text={text}
        result={lastResult}
        level={session.level}
        xp={session.xp}
        myPos={myPos}
        onNext={goNext}
        onSeeProgress={() => setPhase('fim')}
      />
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
      {/* cabeçalho do placar */}
      <div
        style={{
          flex: 'none',
          padding: '12px 18px 14px',
          background: 'linear-gradient(180deg, var(--surface-header), var(--bg-app))',
          borderBottom: '1px solid var(--border-1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button
            onClick={leave}
            aria-label={t.backHome}
            style={{
              all: 'unset',
              cursor: 'pointer',
              width: 34,
              height: 34,
              borderRadius: 'var(--r-md)',
              background: 'var(--surface-1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ChevronLeft size={18} />
          </button>
          <Badge tone="live" dot>
            {t.liveShort} · {minute}’
          </Badge>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 11,
              fontWeight: fw.heavy,
              color: 'var(--gold)',
            }}
          >
            <Star />
            {fmt(session.xp)} XP
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, padding: '0 6px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 96 }}>
            <FlagArgentina />
            <span style={{ fontWeight: fw.heavy, fontSize: 13.5, textAlign: 'center' }}>{t.tArgentina}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontWeight: fw.black, fontSize: 40, fontStyle: 'italic', letterSpacing: -2, lineHeight: 1 }}>
              {scoreA} – {scoreB}
            </span>
            <span style={{ fontSize: 10, fontWeight: fw.heavy, letterSpacing: 0.8, color: 'var(--text-muted)', marginTop: 4 }}>
              {t.groupJ}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 96 }}>
            <FlagCaboVerde />
            <span style={{ fontWeight: fw.heavy, fontSize: 13.5, textAlign: 'center' }}>{t.tCaboVerde}</span>
          </div>
        </div>
      </div>

      <div style={{ flex: 'none', padding: '12px 18px 0' }}>
        <SegTabs
          tabs={[
            { label: t.salaTabPlays, value: 'lances' },
            { label: t.salaTabStats, value: 'stats' },
            { label: t.salaTabRanking, value: 'ranking' },
          ]}
          value={salaTab}
          onChange={(v) => setSalaTab(v as SalaTab)}
        />
      </div>

      {/* O padding de 380px no rodapé é o que deixa o último item legível por
          cima do sheet. Sem ele o desafio tapa o conteúdo. */}
      <Screen padding="14px 18px 380px">
        {salaTab === 'lances' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {feed.map((ev, i) => (
              <div
                key={`${ev.t}-${i}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '11px 2px',
                  borderBottom: '1px solid var(--border-1)',
                }}
              >
                <span style={{ fontSize: 11, fontWeight: fw.black, color: 'var(--lime)', minWidth: 34 }}>{ev.t}</span>
                <span style={{ fontSize: 13.5, fontWeight: fw.medium, color: 'var(--text-1)' }}>
                  {lang === 'en' ? ev.en : ev.pt}
                </span>
              </div>
            ))}
          </div>
        )}

        {salaTab === 'stats' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ fontWeight: fw.heavy, fontSize: 13, color: 'var(--text-1)' }}>{t.tArgentina}</span>
              <span style={{ fontSize: 10, fontWeight: fw.black, letterSpacing: 1, color: 'var(--text-faint)' }}>
                {t.statsHdr}
              </span>
              <span style={{ fontWeight: fw.heavy, fontSize: 13, color: 'var(--text-1)' }}>{t.tCaboVerde}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {stats.map((st) => (
                <div key={st.label}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontWeight: fw.black, fontSize: 14, color: 'var(--lime)' }}>{st.a}</span>
                    <span style={{ fontSize: 11, fontWeight: fw.heavy, letterSpacing: 0.5, color: 'var(--text-muted)' }}>
                      {st.label}
                    </span>
                    <span style={{ fontWeight: fw.black, fontSize: 14, color: 'var(--text-1)' }}>{st.b}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, height: 8 }}>
                    <div style={{ flex: st.aFlex, background: 'var(--lime)', borderRadius: '99px 4px 4px 99px' }} />
                    <div style={{ flex: st.bFlex, background: 'var(--surface-2)', borderRadius: '4px 99px 99px 4px' }} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {salaTab === 'ranking' && (
          <>
            <div style={{ fontSize: 10, fontWeight: fw.black, letterSpacing: 1, color: 'var(--text-faint)', marginBottom: 10 }}>
              {t.roomRanking} · {fmt(ROOM_SIZE)} {t.inRoom}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {ranking.map((r) => {
                const me = r.id === 'me';
                return (
                  <div
                    key={r.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '12px 14px',
                      borderRadius: 'var(--r-lg)',
                      background: me ? 'var(--lime-a10)' : 'var(--surface-1)',
                      border: `1px solid ${me ? 'var(--lime-line)' : 'var(--border-1)'}`,
                    }}
                  >
                    <span
                      style={{
                        fontWeight: fw.black,
                        fontSize: 13,
                        color: r.pos <= 3 ? 'var(--gold)' : 'var(--text-muted)',
                        minWidth: 20,
                      }}
                    >
                      {r.pos}
                    </span>
                    <span style={{ flex: 1, fontWeight: fw.bold, fontSize: 14, color: me ? 'var(--lime)' : 'var(--text-hi)' }}>
                      {r.name}
                    </span>
                    <span style={{ fontWeight: fw.heavy, fontSize: 13, color: 'var(--gold)' }}>{fmt(r.xp)} XP</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Screen>

      <ChallengeSheet
        spec={spec}
        text={text}
        secs={secs}
        duration={COUNTDOWN_SECONDS}
        onAnswer={resolveChallenge}
      />
    </div>
  );
}
