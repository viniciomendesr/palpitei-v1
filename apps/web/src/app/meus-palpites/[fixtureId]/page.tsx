'use client';

/**
 * "Meus palpites": the fan's own record for a match.
 *
 * It is the post-match summary, not a second screen that looks like it —
 * `ResumoDaPartida` is shared with the room. Only the data source differs, and
 * chance readings are absent in both, which the component handles by dropping
 * that card instead of printing a zero.
 *
 * TWO SOURCES, and the demo one never touches the network (rule 3):
 *  · a real fan reads their FIRST participation from persisted rows, and the
 *    server decides which run that is;
 *  · a demo fan reads the run they played in THIS session, held in memory. That
 *    is their own play read back, not invented data — but it is volatile, so a
 *    hard reload sends them back to the disabled button, like the rest of demo.
 */

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Screen } from '@/components/Shell';
import { ResumoDaPartida, linhasDeStats, type LinhaDeStat } from '@/components/sala/ResumoDaPartida';
import { useI18n } from '@/lib/i18n';
import { useRequireSession } from '@/lib/guard';
import { useSession } from '@/lib/session';
import { usePrivyAuth } from '@/components/privy/PrivyIsland';
import { useDemoPlay } from '@/components/demo/DemoPlay';
import { resultadosDoDemo } from '@/lib/demo-resumo';
import { CHALLENGES, ROOM_SIZE, liveStats } from '@/lib/mock';
import { fw } from '@/lib/tokens';
import { api, type ApiParticipation } from '@/lib/api';
import { localizeTeamName } from '@/lib/team-names';
import type { SalaResultado } from '@/lib/useSala';

export default function MeusPalpitesPage() {
  const router = useRouter();
  const params = useParams<{ fixtureId: string }>();
  const { t, lang } = useI18n();
  const ready = useRequireSession();
  const { session } = useSession();
  const privy = usePrivyAuth();
  const { runOf } = useDemoPlay();

  const roomId = params?.fixtureId ?? '';
  const fixtureId = Number(roomId);
  const ehDemo = session?.authMethod === 'demo';

  const [dados, setDados] = useState<ApiParticipation | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // The Privy island mounts after the screens, so the token provider is only
  // registered a cycle later. Fetching before `ready && authenticated` sends the
  // request with no Bearer and gets a 401 for a fan who IS logged in. Demo is
  // excluded from the whole effect, so no request ever leaves that path.
  const podeBuscar =
    !ehDemo && ready && privy.ready && privy.authenticated && Number.isInteger(fixtureId);

  useEffect(() => {
    if (!podeBuscar) return;
    let vivo = true;
    api
      .participation(fixtureId)
      .then((r) => vivo && setDados(r))
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : t.meusPalpitesErro));
    return () => {
      vivo = false;
    };
  }, [podeBuscar, fixtureId, t.meusPalpitesErro]);

  if (!ready) return null;

  const voltar = () => router.push('/home');

  if (ehDemo) {
    const run = runOf(roomId);
    // No run means they have not played it this session; the Home button is
    // disabled in that case, so this is only reachable by typing the URL.
    if (!run) return <Aviso texto={t.meusPalpitesDemoVazio} />;

    // Demo stats are the room's own simulated figures, already labelled as such
    // on that screen and carrying no TxLINE badge. They are reused as-is rather
    // than recomputed from a feed that does not exist here.
    const stats: LinhaDeStat[] = liveStats(t).map((row) => ({
      chave: row.label,
      label: row.label,
      a: row.a,
      b: row.b,
      aFlex: row.aFlex,
      bFlex: row.bFlex,
    }));

    return (
      <ResumoDaPartida
        teamA={t.tArgentina}
        teamB={t.tCaboVerde}
        score={{ p1: run.scoreA, p2: run.scoreB }}
        resultados={resultadosDoDemo(run, CHALLENGES, t.ch)}
        rankingCount={ROOM_SIZE}
        chancesCount={null}
        stats={stats}
        title={t.meusPalpitesDemo}
        backLabel={t.meusPalpitesVoltar}
        onBack={voltar}
        onHome={voltar}
      />
    );
  }

  if (erro || !dados) {
    return (
      <Aviso
        texto={erro ? `${t.meusPalpitesErro} ${erro}` : t.meusPalpitesCarregando}
        erro={Boolean(erro)}
      />
    );
  }

  // The summary counts hits from the gabarito, so it needs the same shape the
  // room produces; `facts` are room-only and stay absent rather than invented.
  const resultados: SalaResultado[] = dados.picks.map((pick) => {
    const r: SalaResultado = {
      questionId: pick.questionId,
      prompt: pick.prompt,
      qtype: pick.qtype,
      gained: pick.gained,
      minhaEscolha: pick.choice,
      options: pick.options,
    };
    if (pick.correctOptionId !== undefined) r.correctOptionId = pick.correctOptionId;
    if (pick.voidReason !== undefined) r.voidReason = pick.voidReason;
    return r;
  });

  return (
    <ResumoDaPartida
      teamA={localizeTeamName(dados.teamA, lang)}
      teamB={localizeTeamName(dados.teamB, lang)}
      score={dados.score}
      resultados={resultados}
      rankingCount={dados.players}
      chancesCount={null}
      stats={linhasDeStats(dados.totals, t.statKeys)}
      title={dados.live ? t.meusPalpitesAoVivo : t.meusPalpitesReplay}
      backLabel={t.meusPalpitesVoltar}
      onBack={voltar}
      onHome={voltar}
    />
  );
}

function Aviso({ texto, erro = false }: { texto: string; erro?: boolean }) {
  return (
    <Screen padding="20px 18px">
      <p
        style={{
          marginTop: 40,
          textAlign: 'center',
          fontSize: 13,
          fontWeight: fw.medium,
          lineHeight: 'var(--leading-body)',
          color: erro ? 'var(--red)' : 'var(--text-muted)',
        }}
        role={erro ? 'alert' : undefined}
      >
        {texto}
      </p>
    </Screen>
  );
}
