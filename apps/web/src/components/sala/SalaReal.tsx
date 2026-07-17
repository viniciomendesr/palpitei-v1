'use client';

/**
 * A sala da partida REAL — a mesma casca da sala do mock, outro motor.
 *
 * Vive separada de propósito. A sala do mock resolve o desafio DENTRO do
 * componente (`const correct = optId === spec.correct`) e roda um setInterval
 * como relógio; aqui quem abre, fecha e julga é o servidor, e a tela só desenha
 * o que chega pelo SSE. São duas máquinas de estado opostas — enfiar as duas no
 * mesmo componente com `if (demo)` seria o jeito mais rápido de quebrar o
 * caminho do jurado, que é o único que não pode falhar (§5.1).
 *
 * O que a tela NÃO faz, e é o ponto: não decide acerto, não credita XP, não
 * fecha janela. Se o cronômetro daqui zerar antes do servidor, o palpite ainda
 * vale; se o servidor fechar antes, o POST volta 409 e o fã ouve a verdade.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SegTabs, Badge, Button } from '@/components/ds';
import { Screen } from '@/components/Shell';
import { ChevronLeft, Star } from '@/components/Icons';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { fw } from '@/lib/tokens';
import { useSala, type SalaLance } from '@/lib/useSala';
import { usePrivyAuth } from '@/components/privy/PrivyIsland';

type SalaTab = 'lances' | 'stats' | 'ranking';

/** O nome do lance na voz do fã. Gíria de futebol, nunca jargão de aposta. */
function textoDoLance(l: SalaLance, t: ReturnType<typeof useI18n>['t'], teamA: string, teamB: string): string {
  if (l.goals) return `${t.lanceGoal}: ${teamA} ${l.goals.p1} × ${l.goals.p2} ${teamB}`;
  const nomes: Record<string, string> = {
    kickoff: t.lanceKickoff,
    corner: t.lanceCorner,
    shot: t.lanceShot,
    yellow_card: t.lanceYellow,
    red_card: t.lanceRed,
    substitution: t.lanceSub,
    injury: t.lanceInjury,
    additional_time: t.lanceExtra,
    halftime_finalised: t.lanceHalftime,
    game_finalised: t.lanceEnd,
  };
  return nomes[l.action] ?? l.action;
}

/** As iniciais do time, num disco. Bandeira de verdade só existe para Argentina
 *  e Cabo Verde no ds — e inventar uma bandeira errada é pior que não ter. */
function Escudo({ nome }: { nome: string }) {
  const iniciais = nome.slice(0, 3).toUpperCase();
  return (
    <div
      style={{
        width: 38,
        height: 26,
        borderRadius: 'var(--r-sm)',
        background: 'var(--surface-1)',
        border: '1px solid var(--border-2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 11,
        fontWeight: fw.black,
        letterSpacing: 0.5,
        color: 'var(--text-2)',
      }}
    >
      {iniciais}
    </div>
  );
}

export function SalaReal({ fixtureId }: { fixtureId: string }) {
  const router = useRouter();
  const { t, fmt } = useI18n();
  const { session } = useSession();
  const privy = usePrivyAuth();
  // Espera a ilha ficar pronta ANTES de abrir o stream. O React roda efeitos de
  // baixo pra cima: no primeiro mount, o efeito desta tela corre antes de o
  // PrivyIsland (mãe) registrar o authTokenProvider — o token sai null, o SSE vai
  // sem Bearer e o fã LOGADO lê "sem sessão verificada". É a mesma corrida que
  // derrubou a home; a lição é a mesma.
  const { state, desafio, resultado, erro, palpitar } = useSala(
    fixtureId,
    privy.ready && privy.authenticated,
  );

  const [tab, setTab] = useState<SalaTab>('lances');
  const [secs, setSecs] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [recusa, setRecusa] = useState<string | null>(null);

  // O cronômetro nasce do prazo REAL que o servidor mandou (o Clock já converteu
  // tempo de jogo → tempo real, respeitando o speed do replay). É cosmético: não
  // fecha nada, só mostra. Quem fecha a janela é o servidor.
  useEffect(() => {
    if (!desafio) return;
    setSecs(Math.ceil(desafio.closesInRealMs / 1000));
    setRecusa(null);
    const timer = setInterval(() => setSecs((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [desafio]);

  const responder = async (optionId: string) => {
    if (!desafio || enviando) return;
    setEnviando(true);
    const r = await palpitar(desafio.questionId, optionId);
    setEnviando(false);
    // "janela fechada", "você já palpitou": é o servidor falando. Mostra.
    if (!r.ok) setRecusa(r.error ?? null);
  };

  const esperandoIlha = !privy.ready || !privy.authenticated;
  if (erro && !state && !esperandoIlha) {
    return (
      <Screen padding="20px 18px">
        <p role="alert" style={{ color: 'var(--red)', fontSize: 13, fontWeight: fw.bold, textAlign: 'center' }}>
          {erro}
        </p>
      </Screen>
    );
  }

  if (!state || !session) {
    return (
      <Screen padding="20px 18px">
        <p style={{ color: 'var(--text-muted)', fontSize: 13, fontWeight: fw.medium, textAlign: 'center' }}>
          {t.salaLoading}
        </p>
      </Screen>
    );
  }

  const selo = state.source === 'txline-live' ? t.srcTxline : t.srcReplay;

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
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
            onClick={() => router.push('/home')}
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
          {/* O selo diz a origem, e o estado diz a verdade: uma partida gravada
              NÃO é "ao vivo", por mais que o relógio esteja correndo. */}
          <Badge tone={state.finished ? 'neutral' : 'live'} dot={!state.finished}>
            {state.finished ? t.lanceEnd : `${t.replayShort} · ${state.minute ?? 0}’`}
          </Badge>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: fw.heavy, color: 'var(--gold)' }}>
            <Star />
            {fmt(session.xp)} XP
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, padding: '0 6px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 96 }}>
            <Escudo nome={state.teamA} />
            <span style={{ fontWeight: fw.heavy, fontSize: 13.5, textAlign: 'center' }}>{state.teamA}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontWeight: fw.black, fontSize: 40, fontStyle: 'italic', letterSpacing: -2, lineHeight: 1 }}>
              {state.score.p1} – {state.score.p2}
            </span>
            <span style={{ fontSize: 10, fontWeight: fw.heavy, letterSpacing: 0.8, color: 'var(--text-muted)', marginTop: 4 }}>
              {selo}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 96 }}>
            <Escudo nome={state.teamB} />
            <span style={{ fontWeight: fw.heavy, fontSize: 13.5, textAlign: 'center' }}>{state.teamB}</span>
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
          value={tab}
          onChange={(v) => setTab(v as SalaTab)}
        />
      </div>

      <Screen padding={desafio || resultado ? '14px 18px 320px' : '14px 18px 24px'}>
        {tab === 'lances' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {state.feed.map((l, i) => (
              <div
                key={`${l.action}-${l.minute}-${i}`}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 2px', borderBottom: '1px solid var(--border-1)' }}
              >
                <span style={{ fontSize: 11, fontWeight: fw.black, color: 'var(--lime)', minWidth: 34 }}>
                  {l.minute ?? 0}’
                </span>
                <span style={{ fontSize: 13.5, fontWeight: l.goals ? fw.heavy : fw.medium, color: l.goals ? 'var(--lime)' : 'var(--text-1)' }}>
                  {textoDoLance(l, t, state.teamA, state.teamB)}
                </span>
              </div>
            ))}
            {!state.feed.length && (
              <p style={{ textAlign: 'center', padding: 28, fontSize: 13, fontWeight: fw.medium, color: 'var(--text-muted)' }}>
                {t.salaWaitingKickoff}
              </p>
            )}
          </div>
        )}

        {/* Estatísticas e ranking desta sala ainda não têm fonte real: os totais
            por partida e o ranking dos palpites vivem no servidor e não estão
            expostos. Preferimos dizer isso a mostrar o mock por cima do dado
            real — que é exatamente o G6 que este projeto existe para evitar. */}
        {tab !== 'lances' && (
          <p style={{ textAlign: 'center', padding: 28, fontSize: 13, fontWeight: fw.medium, lineHeight: 'var(--leading-body)', color: 'var(--text-muted)' }}>
            {t.salaEmBreve}
          </p>
        )}
      </Screen>

      {/* o desafio */}
      {desafio && !resultado && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            padding: '18px 18px 22px',
            background: 'var(--surface-header)',
            borderTop: '1px solid var(--border-2)',
            borderRadius: 'var(--r-xl) var(--r-xl) 0 0',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10.5, fontWeight: fw.black, letterSpacing: 1, color: 'var(--lime)' }}>
              {t.salaChallenge} · +{desafio.xp} XP
            </span>
            <span style={{ fontSize: 12, fontWeight: fw.black, color: secs <= 3 ? 'var(--red)' : 'var(--text-2)' }}>
              {secs}s
            </span>
          </div>

          <p style={{ fontSize: 17, fontWeight: fw.heavy, marginTop: 10, textWrap: 'pretty' }}>{desafio.prompt}</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
            {desafio.options.map((o) => (
              <Button key={o.id} variant="ghost" full disabled={enviando} onClick={() => responder(o.id)}>
                {o.label}
                {/* pct vem do explicador de odds, que esta sala ainda não roda.
                    null = a TxLINE não mandou preço (G8) — e AUSENTE não é 0%.
                    Mostrar "0%" aqui seria a explicação fantasma do v0. */}
              </Button>
            ))}
          </div>

          {recusa && (
            <p role="alert" style={{ marginTop: 10, fontSize: 12, fontWeight: fw.bold, color: 'var(--red)', textAlign: 'center' }}>
              {recusa}
            </p>
          )}
        </div>
      )}

      {/* o resultado do MEU palpite */}
      {resultado && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            padding: '18px 18px 22px',
            background: 'var(--surface-header)',
            borderTop: '1px solid var(--border-2)',
            borderRadius: 'var(--r-xl) var(--r-xl) 0 0',
            textAlign: 'center',
          }}
        >
          {resultado.voidReason ? (
            <>
              <p style={{ fontSize: 16, fontWeight: fw.black, color: 'var(--text-1)' }}>{t.salaVoid}</p>
              <p style={{ fontSize: 12.5, fontWeight: fw.medium, color: 'var(--text-2)', marginTop: 6, textWrap: 'pretty' }}>
                {t.salaVoidBody}
              </p>
            </>
          ) : (
            <>
              <p style={{ fontSize: 20, fontWeight: fw.black, fontStyle: 'italic', color: resultado.gained > 0 ? 'var(--lime)' : 'var(--text-1)' }}>
                {resultado.gained > 0 ? `${t.salaHit} +${resultado.gained} XP` : t.salaMiss}
              </p>
              <p style={{ fontSize: 12.5, fontWeight: fw.medium, color: 'var(--text-2)', marginTop: 6 }}>
                {t.salaCorrectWas}{' '}
                <strong style={{ color: 'var(--text-hi)' }}>{resultado.correctOptionId ?? '—'}</strong>
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
