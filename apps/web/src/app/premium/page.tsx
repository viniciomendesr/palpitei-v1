'use client';


import { useRouter } from 'next/navigation';
import { Button } from '@/components/ds';
import { Screen } from '@/components/Shell';
import { ChevronDown, Check, Crown } from '@/components/Icons';
import { useI18n } from '@/lib/i18n';
import { useRequireSession } from '@/lib/guard';
import { fw } from '@/lib/tokens';

export default function PremiumPage() {
  const router = useRouter();
  const { t } = useI18n();
  const ready = useRequireSession();

  if (!ready) return null;

  const rows: { label: string; sub?: string; free: string; premium: true | string }[] = [
    { label: t.pxRowLeagues, sub: t.pxRowLeaguesSub, free: t.pxFreeLeagues, premium: t.pxUnlimited },
    { label: t.pxRowBracket, free: '–', premium: true },
    { label: t.pxRowRead, free: '–', premium: true },
    { label: t.pxRowCustom, free: '–', premium: true },
    { label: t.pxRowNoAds, free: '–', premium: true },
    { label: t.pxRowReminder, free: t.yes, premium: true },
    { label: t.pxRowPicks, free: t.yes, premium: true },
    { label: t.pxRowRank, free: t.yes, premium: true },
  ];

  return (
    <Screen style={{ display: 'flex', flexDirection: 'column', overflowY: 'hidden', padding: 0 }}>
      <div
        role="region"
        aria-label={t.pxComparisonLabel}
        tabIndex={0}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          scrollbarWidth: 'thin',
          scrollPaddingBottom: 24,
          padding: '8px 22px 18px',
        }}
      >
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0 10px' }}>
          <button
            onClick={() => router.back()}
            aria-label={t.cancel}
            style={{
              all: 'unset',
              cursor: 'pointer',
              width: 34,
              height: 34,
              borderRadius: 'var(--r-md)',
              background: 'var(--surface-1)',
              border: '1px solid var(--border-1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ChevronDown />
          </button>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '6px 13px',
              borderRadius: 'var(--r-pill)',
              background: 'var(--lime)',
              color: 'var(--on-lime)',
              fontSize: 11,
              fontWeight: fw.black,
              letterSpacing: 0.6,
            }}
          >
            <Crown size={13} />
            {t.pxBadge}
          </span>
          <span style={{ width: 34 }} />
        </div>

        <div style={{ marginTop: 10 }}>
          <div style={{ fontWeight: fw.black, fontStyle: 'italic', fontSize: 34, letterSpacing: -1.5, lineHeight: 1.02, textWrap: 'pretty' }}>
            {t.pxH1}
            <br />
            {t.pxH2} <span style={{ color: 'var(--lime)' }}>{t.pxH3}</span>
          </div>
          <p
            style={{
              fontSize: 14.5,
              lineHeight: 'var(--leading-body)',
              fontWeight: fw.medium,
              color: 'var(--text-2)',
              marginTop: 12,
              textWrap: 'pretty',
            }}
          >
            {t.pxSub}
          </p>
        </div>

        <div style={{ marginTop: 22, fontSize: 11.5, fontWeight: fw.bold, color: 'var(--text-muted)' }}>{t.pxScrollHint}</div>

        <div style={{ marginTop: 8, border: '1px solid var(--border-2)', borderRadius: 'var(--r-3xl)', overflow: 'hidden' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '12px 16px',
              background: 'var(--surface-1)',
              borderBottom: '1px solid var(--border-1)',
            }}
          >
            <span style={{ flex: 1 }} />
            <span style={{ width: 64, textAlign: 'center', fontSize: 11, fontWeight: fw.black, letterSpacing: 0.5, color: 'var(--text-muted)' }}>
              {t.pxFree}
            </span>
            <span style={{ width: 72, textAlign: 'center', fontSize: 11, fontWeight: fw.black, letterSpacing: 0.5, color: 'var(--lime)' }}>
              {t.pxPremium}
            </span>
          </div>

          {rows.map((row) => (
            <div
              key={row.label}
              style={{ display: 'flex', alignItems: 'center', padding: '13px 16px', borderBottom: '1px solid var(--border-1)' }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: fw.bold, fontSize: 14 }}>{row.label}</div>
                {row.sub && (
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: fw.medium }}>{row.sub}</div>
                )}
              </div>
              <span
                style={{
                  width: 64,
                  textAlign: 'center',
                  fontSize: 12.5,
                  fontWeight: fw.heavy,
                  color: row.free === '–' ? 'var(--text-fainter)' : 'var(--text-2)',
                }}
              >
                {row.free}
              </span>
              <span style={{ width: 72, display: 'flex', justifyContent: 'center' }}>
                {row.premium === true ? (
                  <Check />
                ) : (
                  <span style={{ fontWeight: fw.heavy, fontSize: 12.5, color: 'var(--lime)' }}>{row.premium}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          flex: 'none',
          padding: '14px 22px calc(18px + env(safe-area-inset-bottom, 0px))',
          borderTop: '1px solid var(--border-1)',
          background: 'var(--bg-app)',
        }}
      >
        <Button size="lg" full onClick={() => router.push('/premium/planos')}>
          {t.pxSeePlans}
        </Button>
      </div>
    </Screen>
  );
}
