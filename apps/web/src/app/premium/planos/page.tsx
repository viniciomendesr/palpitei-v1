'use client';

/** PREMIUM · PLANOS — anual (padrão, com 7 dias grátis) ou mensal. */

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ds';
import { Screen } from '@/components/Shell';
import { ChevronLeft } from '@/components/Icons';
import { useI18n } from '@/lib/i18n';
import { useSession, type PlanId } from '@/lib/session';
import { useRequireSession } from '@/lib/guard';
import { fw } from '@/lib/tokens';

export default function PlanosPage() {
  const router = useRouter();
  const { t } = useI18n();
  const { session, update } = useSession();
  const ready = useRequireSession();

  if (!ready || !session) return null;

  return (
    <Screen style={{ display: 'flex', flexDirection: 'column', padding: '8px 22px 26px' }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '4px 0 14px' }}>
        <button
          onClick={() => router.push('/premium')}
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
          <ChevronLeft />
        </button>
        <span style={{ fontWeight: fw.black, fontStyle: 'italic', fontSize: 20, letterSpacing: -0.5 }}>
          {t.plTitle}
        </span>
      </div>

      <p
        style={{
          fontSize: 14,
          lineHeight: 'var(--leading-body)',
          fontWeight: fw.medium,
          color: 'var(--text-2)',
          margin: '0 0 18px',
          textWrap: 'pretty',
        }}
      >
        {t.plSub}
      </p>

      <PlanCard
        id="anual"
        selected={session.selectedPlan === 'anual'}
        onSelect={() => update({ selectedPlan: 'anual' })}
        title={t.plAnnual}
        price={t.plAnnualPrice}
        perMonth={t.plPerMonth}
        desc={t.plAnnualDesc}
        note={t.plAnnualNote}
        badge={t.plBest}
        discount={t.plDiscount}
      />

      <PlanCard
        id="mensal"
        selected={session.selectedPlan === 'mensal'}
        onSelect={() => update({ selectedPlan: 'mensal' })}
        title={t.plMonthly}
        price={t.plMonthlyPrice}
        perMonth={t.plPerMonth}
        desc={t.plMonthlyDesc}
      />

      <div style={{ flex: 1, minHeight: 18 }} />
      <div
        style={{
          position: 'sticky',
          bottom: 0,
          paddingTop: 14,
          background: 'linear-gradient(180deg, transparent, var(--bg-app) 32%)',
        }}
      >
        <Button size="lg" full onClick={() => router.push('/premium/checkout')}>
          {t.plContinue}
        </Button>
        <div style={{ textAlign: 'center', fontSize: 11, fontWeight: fw.medium, color: 'var(--text-muted)', marginTop: 10 }}>
          {t.plFoot}
        </div>
      </div>
    </Screen>
  );
}

function PlanCard({
  id,
  selected,
  onSelect,
  title,
  price,
  perMonth,
  desc,
  note,
  badge,
  discount,
}: {
  id: PlanId;
  selected: boolean;
  onSelect: () => void;
  title: string;
  price: string;
  perMonth: string;
  desc: string;
  note?: string;
  badge?: string;
  discount?: string;
}) {
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${title} ${price}`}
      data-plan={id}
      style={{
        all: 'unset',
        boxSizing: 'border-box',
        cursor: 'pointer',
        display: 'block',
        width: '100%',
        marginBottom: 12,
        padding: 18,
        borderRadius: 'var(--r-2xl)',
        transition: 'border-color .15s, background .15s',
        background: selected ? 'var(--lime-a10)' : 'var(--surface-1)',
        border: `2px solid ${selected ? 'var(--lime)' : 'var(--border-1)'}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: fw.heavy, fontSize: 16 }}>{title}</span>
          {badge && (
            <span
              style={{
                fontSize: 9.5,
                fontWeight: fw.black,
                letterSpacing: 0.5,
                color: 'var(--on-lime)',
                background: 'var(--lime)',
                padding: '3px 8px',
                borderRadius: 'var(--r-pill)',
              }}
            >
              {badge}
            </span>
          )}
        </div>
        {discount && <span style={{ fontSize: 11, fontWeight: fw.black, color: 'var(--lime)' }}>{discount}</span>}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 12 }}>
        <span style={{ fontWeight: fw.black, fontStyle: 'italic', fontSize: 32, letterSpacing: -1 }}>{price}</span>
        <span style={{ fontSize: 13, fontWeight: fw.bold, color: 'var(--text-muted)' }}>{perMonth}</span>
      </div>
      <div style={{ fontSize: 12.5, fontWeight: fw.medium, color: 'var(--text-2)', marginTop: 4 }}>{desc}</div>
      {note && <div style={{ fontSize: 11.5, fontWeight: fw.bold, color: 'var(--lime)', marginTop: 6 }}>{note}</div>}
    </button>
  );
}
