'use client';

/**
 * RANKING — a temporada inteira, atualizada ao vivo.
 *
 * "atualizada ao vivo", nunca "odds"/"mercado". A linha do fã aparece destacada
 * em lime; as três primeiras posições em --gold.
 *
 * Na v1 as linhas chegam pelo evento `ranking` do WS.
 */

import { Screen } from '@/components/Shell';
import { useI18n } from '@/lib/i18n';
import { useSession, initialsOf } from '@/lib/session';
import { useRequireSession } from '@/lib/guard';
import { fw } from '@/lib/tokens';
import { globalRanking } from '@/lib/mock';

export default function RankingPage() {
  const { t, fmt } = useI18n();
  const { session } = useSession();
  const ready = useRequireSession();

  if (!ready || !session) return null;

  const rows = globalRanking(t, {
    nickname: session.nickname,
    initials: initialsOf(session.nickname, session.accountType),
    xp: session.xp,
  });

  return (
    <Screen padding="12px 18px 20px">
      <div style={{ fontWeight: fw.black, fontStyle: 'italic', fontSize: 24, letterSpacing: -0.5, padding: '6px 0 4px' }}>
        {t.rankingTitle}
      </div>
      <div style={{ fontSize: 13, fontWeight: fw.medium, color: 'var(--text-muted)', marginBottom: 14 }}>
        {t.rankingSub}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((r) => (
          <div
            key={`${r.pos}-${r.name}`}
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
                color: r.pos <= 3 ? 'var(--gold)' : 'var(--text-muted)',
                minWidth: 24,
              }}
            >
              {r.pos}
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
