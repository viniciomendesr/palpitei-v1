'use client';

/**
 * TxLINE Seal proof screen: the receipt for a minted prediction.
 *
 * Demo only, and honest about it. There is no chain behind a demo mint, so the transaction
 * field says exactly that and the explorer link is disabled. Printing a signature-shaped
 * string here would be a provenance label that lies (G6) on the one screen whose entire
 * job is proving provenance.
 */

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ds';
import { Screen } from '@/components/Shell';
import { ChevronLeft, Seal, ShieldCheck } from '@/components/Icons';
import {
  FieldRow,
  Panel,
  SectionLabel,
  softOf,
} from '@/components/marketplace/PerkVisuals';
import { useMarketplace } from '@/components/marketplace/MarketplaceState';
import { useI18n } from '@/lib/i18n';
import { useRequireSession } from '@/lib/guard';
import { fw } from '@/lib/tokens';
import { canOpenDetail } from '@/lib/marketplace';

export default function SealProofPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { t, lang } = useI18n();
  const ready = useRequireSession();
  const { isDemo, mintedPicks } = useMarketplace();

  const pickId = params?.id ?? '';
  const mintedAt = mintedPicks[pickId];
  const unreachable = ready && (!canOpenDetail(isDemo) || mintedAt === undefined);

  // Nothing was minted, so there is no proof to render.
  useEffect(() => {
    if (unreachable) router.replace('/marketplace');
  }, [unreachable, router]);

  if (!ready || unreachable || mintedAt === undefined) return null;

  const mintedLabel = new Date(mintedAt).toLocaleString(lang === 'en' ? 'en-US' : 'pt-BR');

  return (
    <Screen padding="12px 18px 24px">
      <button
        onClick={() => router.push('/marketplace')}
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

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          marginTop: 18,
          padding: '24px 18px',
          borderRadius: 'var(--r-3xl)',
          background: `linear-gradient(150deg, ${softOf('var(--gold)', 16)}, var(--surface-1) 62%)`,
          border: `1.5px solid ${softOf('var(--gold)', 45)}`,
          animation: 'popIn .3s cubic-bezier(.2,.9,.3,1.2) both',
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 'var(--r-2xl)',
            background: softOf('var(--gold)', 16),
            border: `1px solid ${softOf('var(--gold)', 45)}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Seal size={34} />
        </div>
        <span
          style={{
            marginTop: 14,
            fontSize: 9.5,
            fontWeight: fw.black,
            letterSpacing: 1.2,
            color: 'var(--gold)',
          }}
        >
          {t.mkPocSeal}
        </span>
        <h1
          style={{
            margin: '8px 0 0',
            fontWeight: fw.black,
            fontStyle: 'italic',
            fontSize: 22,
            letterSpacing: -0.5,
          }}
        >
          {t.mkDemoMatch}
        </h1>
        <span
          style={{
            marginTop: 12,
            fontSize: 9,
            fontWeight: fw.black,
            letterSpacing: 1,
            color: 'var(--text-muted)',
            background: 'var(--surface-2)',
            border: '1px solid var(--border-2)',
            padding: '4px 10px',
            borderRadius: 'var(--r-pill)',
          }}
        >
          {t.mkDemoTag}
        </span>
      </div>

      <SectionLabel>{t.mkPocProofHdr}</SectionLabel>
      <Panel>
        <FieldRow label={t.mkPocMatch} value={t.mkDemoMatch} />
        <FieldRow label={t.mkPocMarket} value={t.mkDemoMarket} />
        <FieldRow label={t.mkPocPred} value={t.mkDemoPrediction} />
        <FieldRow label={t.mkPocTx} value={t.mkPocTxDemo} muted />
        <FieldRow label={t.mkPocMinted} value={mintedLabel} last />
      </Panel>

      <div style={{ marginTop: 18 }}>
        {/* Disabled on purpose: a demo mint has no transaction to open. */}
        <Button variant="secondary" full disabled aria-label={t.mkVerify}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <ShieldCheck size={14} color="var(--text-muted)" />
            {t.mkVerify}
          </span>
        </Button>
      </div>
    </Screen>
  );
}
