'use client';


import { useEffect, useState } from 'react';
import { Screen } from '@/components/Shell';
import { useI18n } from '@/lib/i18n';
import { useSession, initialsOf } from '@/lib/session';
import { useRequireSession } from '@/lib/guard';
import { usePrivyAuth } from '@/components/privy/PrivyIsland';
import { fw } from '@/lib/tokens';
import { globalRanking } from '@/lib/mock';
import { api, type ApiRankRow } from '@/lib/api';

type Linha = {
  pos: number | null;
  name: string;
  initials: string;
  sub: string;
  xp: number;
  avBg: string;
  avColor: string;
  me?: boolean;
};

export default function RankingPage() {
  const { t, fmt } = useI18n();
  const { session } = useSession();
  const ready = useRequireSession();
  const privy = usePrivyAuth();

  const [reais, setReais] = useState<ApiRankRow[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const ehDemo = !session || session.authMethod === 'demo';
  const podeBuscar = !ehDemo && privy.ready && privy.authenticated;

  useEffect(() => {
    if (!podeBuscar) return;
    let vivo = true;
    api
      .ranking()
      .then((r) => vivo && setReais(r.rows))
      .catch(() => vivo && setErro(t.rankingLoadFailed));
    return () => {
      vivo = false;
    };
  }, [podeBuscar, t.rankingLoadFailed]);

  if (!ready || !session) return null;

  const rows: Linha[] = ehDemo
    ? globalRanking(t, {
        nickname: session.nickname,
        initials: initialsOf(session.nickname, session.accountType),
        xp: session.xp,
      })
    : (reais ?? []).map((r) => ({
        pos: r.pos,
        name: r.me ? session.nickname || r.name : r.name,
        initials: initialsOf(r.name, 'existing'),
        sub: `${t.lv} ${r.level}`,
        xp: r.xp,
        avBg: r.me ? 'var(--lime)' : 'var(--surface-2)',
        avColor: r.me ? 'var(--on-lime)' : 'var(--text-1)',
        me: r.me,
      }));

  const carregando = !ehDemo && !erro && reais === null;

  return (
    <Screen padding="12px 18px 20px">
      <div style={{ fontWeight: fw.black, fontStyle: 'italic', fontSize: 24, letterSpacing: -0.5, padding: '6px 0 4px' }}>
        {t.rankingTitle}
      </div>
      <div style={{ fontSize: 13, fontWeight: fw.medium, color: 'var(--text-muted)', marginBottom: 14 }}>
        {t.rankingSub}
      </div>

      {erro && (
        <p role="alert" style={{ textAlign: 'center', padding: 24, fontSize: 13, fontWeight: fw.bold, color: 'var(--red)' }}>
          {erro}
        </p>
      )}

      {carregando && (
        <p style={{ textAlign: 'center', padding: 24, fontSize: 13, fontWeight: fw.medium, color: 'var(--text-muted)' }}>
          {t.salaLoading}
        </p>
      )}

      {!erro && !carregando && !rows.length && (
        <p style={{ textAlign: 'center', padding: 24, fontSize: 13, fontWeight: fw.medium, lineHeight: 'var(--leading-body)', color: 'var(--text-muted)' }}>
          {t.rankingEmpty}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((r, i) => (
          <div
            key={`${r.pos ?? 'eu'}-${r.name}-${i}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 13,
              padding: '13px 15px',
              borderRadius: 'var(--r-xl)',
              background: r.me ? 'var(--lime-a10)' : 'var(--surface-1)',
              border: `1px solid ${r.me ? 'var(--lime-line)' : 'var(--border-1)'}`,
            }}
          >
            <span
              style={{
                fontWeight: fw.black,
                fontSize: 15,
                color: r.pos !== null && r.pos <= 3 ? 'var(--gold)' : 'var(--text-muted)',
                minWidth: 24,
              }}
            >
              {r.pos ?? '—'}
            </span>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--r-md)',
                background: r.avBg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: fw.black,
                fontStyle: 'italic',
                fontSize: 13,
                color: r.avColor,
                flex: 'none',
              }}
            >
              {r.initials}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontWeight: fw.heavy,
                  fontSize: 14.5,
                  color: r.me ? 'var(--lime)' : 'var(--text-hi)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {r.name}
              </div>
              <div style={{ fontSize: 11.5, fontWeight: fw.medium, color: 'var(--text-muted)' }}>{r.sub}</div>
            </div>
            <span style={{ fontWeight: fw.black, fontSize: 14, color: 'var(--gold)' }}>{fmt(r.xp)} XP</span>
          </div>
        ))}
      </div>
    </Screen>
  );
}
