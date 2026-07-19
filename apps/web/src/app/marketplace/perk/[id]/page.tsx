'use client';

/**
 * Perk detail. It exists for the demo flow only: the store is empty for a real fan, so a
 * real account that reaches this URL by hand is sent back instead of being shown an item
 * it cannot obtain (rule 4). The redeem action is local and simulated (rule 3).
 */

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ds';
import { Screen } from '@/components/Shell';
import { ChevronLeft, ShieldCheck } from '@/components/Icons';
import {
  FieldRow,
  MarketToast,
  Panel,
  PerkIcon,
  SectionLabel,
  currencyColor,
  currencyLabel,
  rarityLabel,
  rarityTone,
} from '@/components/marketplace/PerkVisuals';
import { useMarketplace } from '@/components/marketplace/MarketplaceState';
import { useI18n } from '@/lib/i18n';
import { useRequireSession } from '@/lib/guard';
import { fw } from '@/lib/tokens';
import { DEMO_ELIGIBLE_PICK, canAfford, canOpenDetail, perkById } from '@/lib/marketplace';

export default function PerkDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { t, fmt } = useI18n();
  const ready = useRequireSession();
  const { isDemo, balances, ownedPerks, mintedPicks, toast, redeem, mintPick } = useMarketplace();

  const perk = perkById(params?.id ?? '');
  const unreachable = ready && (!canOpenDetail(isDemo) || !perk);

  // A real fan has no store, so there is no detail to show them.
  useEffect(() => {
    if (unreachable) router.replace('/marketplace');
  }, [unreachable, router]);

  if (!ready || !perk || unreachable) return null;

  const copy = t.mkPerks[perk.id];
  const tone = rarityTone(perk.rarity);
  const owned = ownedPerks.has(perk.id);
  const isSeal = perk.id === 'poc';
  const alreadyMinted = mintedPicks[DEMO_ELIGIBLE_PICK.id] !== undefined;
  const affordable = canAfford(perk, balances);

  const act = () => {
    if (isSeal) {
      if (mintPick(DEMO_ELIGIBLE_PICK.id)) router.push(`/marketplace/poc/${DEMO_ELIGIBLE_PICK.id}`);
      return;
    }
    if (redeem(perk)) router.push('/marketplace');
  };

  const ctaLabel = owned || (isSeal && alreadyMinted) ? t.mkInInventory : isSeal ? t.mkMint : t.mkRedeem;
  const ctaDisabled = owned || (isSeal && alreadyMinted) || !affordable;

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <Screen padding="12px 18px 20px">
        <button
          onClick={() => router.back()}
          aria-label={t.mkBack}
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

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 16 }}>
          <div
            style={{
              flex: 'none',
              width: 66,
              height: 66,
              borderRadius: 'var(--r-xl)',
              background: tone.soft,
              border: `1px solid ${tone.line}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <PerkIcon name={perk.icon} size={30} color={tone.color} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span
              style={{
                display: 'inline-block',
                fontSize: 8.5,
                fontWeight: fw.black,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
                color: tone.color,
                background: tone.soft,
                border: `1px solid ${tone.line}`,
                padding: '3px 8px',
                borderRadius: 'var(--r-pill)',
              }}
            >
              {rarityLabel(perk.rarity, t)}
            </span>
            <h1
              style={{
                margin: '8px 0 0',
                fontWeight: fw.black,
                fontStyle: 'italic',
                fontSize: 23,
                letterSpacing: -0.5,
              }}
            >
              {copy.title}
            </h1>
          </div>
        </div>

        <p
          style={{
            margin: '12px 0 0',
            fontSize: 13.5,
            fontWeight: fw.medium,
            color: 'var(--text-2)',
            lineHeight: 'var(--leading-body)',
          }}
        >
          {copy.sub}
        </p>

        {perk.verifiable && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              marginTop: 12,
              padding: '7px 11px',
              borderRadius: 'var(--r-pill)',
              background: 'var(--lime-a10)',
              border: '1px solid var(--lime-line)',
              fontSize: 11,
              fontWeight: fw.heavy,
              color: 'var(--lime)',
            }}
          >
            <ShieldCheck size={13} />
            {t.mkOnChain}
          </div>
        )}

        <SectionLabel>{t.mkWhat}</SectionLabel>
        <Panel>
          <p
            style={{
              margin: 0,
              fontSize: 13.5,
              fontWeight: fw.medium,
              color: 'var(--text-2)',
              lineHeight: 'var(--leading-body)',
            }}
          >
            {copy.desc}
          </p>
        </Panel>

        <SectionLabel>{t.mkPrice}</SectionLabel>
        <Panel>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
            <span style={{ fontWeight: fw.black, fontSize: 26, color: currencyColor(perk.currency) }}>
              {perk.currency === 'xp' ? fmt(perk.price) : perk.price}
            </span>
            <span style={{ fontWeight: fw.heavy, fontSize: 13, color: currencyColor(perk.currency) }}>
              {currencyLabel(perk.currency, t, perk.price)}
            </span>
          </div>
        </Panel>

        {copy.req && (
          <>
            <SectionLabel>{t.mkReq}</SectionLabel>
            <Panel>
              <span style={{ fontSize: 13, fontWeight: fw.bold, color: 'var(--text-1)' }}>{copy.req}</span>
            </Panel>
          </>
        )}

        {isSeal && (
          <>
            <SectionLabel>{t.mkPocEligHdr}</SectionLabel>
            <Panel>
              <FieldRow label={t.mkPocMatch} value={t.mkDemoMatch} />
              <FieldRow label={t.mkPocMarket} value={t.mkDemoMarket} />
              <FieldRow label={t.mkPocPred} value={t.mkDemoPrediction} last />
            </Panel>
          </>
        )}

        <div style={{ marginTop: 20 }}>
          <Button full disabled={ctaDisabled} onClick={act}>
            {ctaLabel}
          </Button>
          {!affordable && !owned && (
            <p
              style={{
                margin: '10px 0 0',
                textAlign: 'center',
                fontSize: 12,
                fontWeight: fw.bold,
                color: 'var(--text-muted)',
              }}
            >
              {t.mkNotEnough}
            </p>
          )}
        </div>
      </Screen>

      {toast && <MarketToast title={toast.title} sub={toast.sub} />}
    </div>
  );
}
