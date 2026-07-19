'use client';

/**
 * Marketplace: the store and the fan's collection.
 *
 * Two flows on purpose. A demo account gets the full store (category chips, the showcase
 * card and the perk grid) plus a populated collection, so the whole vision is visible
 * without a wallet (hackathon §5.1). A real fan gets the "coming soon" state and an empty
 * collection, because shipping inventory that does not exist would be a mockup (rule 4).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, SegTabs } from '@/components/ds';
import { Screen } from '@/components/Shell';
import { Bolt, Info, Lock, Seal, ShieldCheck, Trophy } from '@/components/Icons';
import {
  MarketToast,
  PerkIcon,
  currencyColor,
  currencyLabel,
  rarityLabel,
  rarityTone,
  softOf,
} from '@/components/marketplace/PerkVisuals';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { useRequireSession } from '@/lib/guard';
import { usePrivyAuth } from '@/components/privy/PrivyIsland';
import { fw } from '@/lib/tokens';
import {
  DEMO_ELIGIBLE_PICK,
  STORE_CATEGORIES,
  perkById,
  perksInCategory,
  showsFeaturedCard,
  storeMode,
  walletChip,
  type Perk,
  type PerkCategory,
} from '@/lib/marketplace';
import { useMarketplace } from '@/components/marketplace/MarketplaceState';

type MarketTab = 'store' | 'collection';

export default function MarketplacePage() {
  const router = useRouter();
  const { t, fmt } = useI18n();
  const { session } = useSession();
  const privy = usePrivyAuth();
  const ready = useRequireSession();
  const { isDemo, balances, ownedPerks, mintedPicks, toast, mintPick } = useMarketplace();

  const [tab, setTab] = useState<MarketTab>('store');
  const [category, setCategory] = useState<PerkCategory>('featured');
  const [trophyInfo, setTrophyInfo] = useState(false);

  if (!ready || !session) return null;

  // Demo never reads Privy for an address: the account is local and has no wallet.
  const chip = walletChip({ isDemo, address: isDemo ? null : privy.wallets[0]?.address });
  const mode = storeMode(isDemo);
  const featured = perkById('poc');
  const eligibleMinted = mintedPicks[DEMO_ELIGIBLE_PICK.id] !== undefined;

  const catLabel: Record<PerkCategory, string> = {
    featured: t.mkCatFeatured,
    game: t.mkCatGame,
    partners: t.mkCatPartners,
    identity: t.mkCatIdentity,
    social: t.mkCatSocial,
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {trophyInfo && <TrophySheet onClose={() => setTrophyInfo(false)} />}

      <header
        style={{
          flex: 'none',
          padding: '12px 18px',
          background: 'linear-gradient(180deg, var(--surface-header), var(--bg-app))',
          borderBottom: '1px solid var(--border-1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <h1
            style={{
              margin: 0,
              fontWeight: fw.black,
              fontStyle: 'italic',
              fontSize: 24,
              letterSpacing: -0.5,
            }}
          >
            {t.mkTitle}
          </h1>
          <WalletChip kind={chip.kind} address={chip.address} />
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <StatTile
            icon={<Bolt size={18} />}
            value={fmt(balances.xp)}
            label={t.mkXpLabel}
            line="var(--lime-line)"
            fill="var(--lime-a14)"
          />
          <StatTile
            icon={<Trophy size={20} />}
            value={String(balances.trophies)}
            label={t.mkTrophyWord}
            line={softOf('var(--gold)', 45)}
            fill={softOf('var(--gold)', 14)}
            valueColor="var(--gold)"
            action={
              <button
                onClick={() => setTrophyInfo(true)}
                aria-label={t.mkTrophyInfoLabel}
                style={{
                  all: 'unset',
                  cursor: 'pointer',
                  flex: 'none',
                  width: 24,
                  height: 24,
                  borderRadius: 'var(--r-sm)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)',
                }}
              >
                <Info />
              </button>
            }
          />
        </div>
      </header>

      <div style={{ flex: 'none', padding: '12px 18px 0' }}>
        <SegTabs
          tabs={[
            { label: t.mkTabStore, value: 'store' },
            { label: t.mkTabCollection, value: 'collection' },
          ]}
          value={tab}
          onChange={(v) => setTab(v as MarketTab)}
        />
      </div>

      <Screen padding="14px 18px 20px">
        {tab === 'store' &&
          (mode === 'soon' ? (
            <StoreSoon />
          ) : (
            <>
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  overflowX: 'auto',
                  overscrollBehavior: 'contain',
                  margin: '0 -18px',
                  padding: '0 18px 4px',
                }}
              >
                {STORE_CATEGORIES.map((c) => {
                  const on = c === category;
                  return (
                    <button
                      key={c}
                      onClick={() => setCategory(c)}
                      aria-pressed={on}
                      style={{
                        all: 'unset',
                        cursor: 'pointer',
                        flex: 'none',
                        padding: '8px 14px',
                        borderRadius: 'var(--r-pill)',
                        fontSize: 12.5,
                        fontWeight: fw.heavy,
                        whiteSpace: 'nowrap',
                        background: on ? 'var(--lime)' : 'var(--surface-1)',
                        border: `1px solid ${on ? 'var(--lime)' : 'var(--border-1)'}`,
                        color: on ? 'var(--on-lime)' : 'var(--text-2)',
                      }}
                    >
                      {catLabel[c]}
                    </button>
                  );
                })}
              </div>

              {showsFeaturedCard(category) && featured && (
                <FeaturedCard perk={featured} onClick={() => router.push('/marketplace/perk/poc')} />
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11, marginTop: 14 }}>
                {perksInCategory(category).map((p) => (
                  <PerkCard
                    key={p.id}
                    perk={p}
                    owned={ownedPerks.has(p.id)}
                    onClick={() => router.push(`/marketplace/perk/${p.id}`)}
                  />
                ))}
              </div>
            </>
          ))}

        {tab === 'collection' && (
          <>
            <h2
              style={{
                margin: 0,
                fontWeight: fw.black,
                fontStyle: 'italic',
                fontSize: 20,
                letterSpacing: -0.4,
              }}
            >
              {t.mkCollTitle}
            </h2>
            <p
              style={{
                margin: '3px 0 14px',
                fontSize: 12.5,
                fontWeight: fw.medium,
                color: 'var(--text-muted)',
              }}
            >
              {isDemo ? t.mkCollSubDemo : t.mkCollSub}
            </p>

            {!isDemo && (
              <div
                style={{
                  padding: '26px 20px',
                  textAlign: 'center',
                  background: 'var(--surface-1)',
                  border: '1.5px dashed var(--border-2)',
                  borderRadius: 'var(--r-2xl)',
                  fontSize: 13.5,
                  fontWeight: fw.medium,
                  color: 'var(--text-muted)',
                  lineHeight: 'var(--leading-body)',
                }}
              >
                {t.mkCollSoonBody}
              </div>
            )}

            {isDemo && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <CollectionRow
                  icon={<Seal size={22} />}
                  tone={rarityTone('legendary')}
                  title={eligibleMinted ? t.mkPocSeal : t.mkDemoMarket}
                  sub={eligibleMinted ? t.mkDemoMatch : t.mkEligibleSub}
                  rarity={t.mkRarLegendary}
                  action={
                    eligibleMinted ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => router.push(`/marketplace/poc/${DEMO_ELIGIBLE_PICK.id}`)}
                      >
                        {t.mkViewProof}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        disabled={balances.trophies < 1}
                        onClick={() => {
                          if (mintPick(DEMO_ELIGIBLE_PICK.id)) {
                            router.push(`/marketplace/poc/${DEMO_ELIGIBLE_PICK.id}`);
                          }
                        }}
                      >
                        {t.mkMint}
                      </Button>
                    )
                  }
                />

                {[...ownedPerks].map((id) => {
                  const perk = perkById(id);
                  if (!perk) return null;
                  const tone = rarityTone(perk.rarity);
                  return (
                    <CollectionRow
                      key={id}
                      icon={<PerkIcon name={perk.icon} size={22} color={tone.color} />}
                      tone={tone}
                      title={t.mkPerks[perk.id].title}
                      sub={t.mkPerks[perk.id].sub}
                      rarity={rarityLabel(perk.rarity, t)}
                      note={t.mkOwnedTag}
                    />
                  );
                })}
              </div>
            )}
          </>
        )}
      </Screen>

      {toast && <MarketToast title={toast.title} sub={toast.sub} />}
    </div>
  );
}

function WalletChip({ kind, address }: { kind: 'demo' | 'address' | 'pending'; address: string | null }) {
  const { t } = useI18n();
  const live = kind === 'address';

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px 6px 11px',
        borderRadius: 'var(--r-pill)',
        background: 'var(--surface-1)',
        border: '1px solid var(--border-2)',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: live ? 'var(--mint)' : 'var(--text-fainter)',
          boxShadow: live ? 'var(--glow-dot)' : 'none',
        }}
      />
      <span style={{ fontSize: 11.5, fontWeight: fw.heavy, letterSpacing: 0.2 }}>
        {kind === 'address' ? address : kind === 'demo' ? t.mkWalletDemo : t.mkWalletPending}
      </span>
      {/* The network tag belongs to a real wallet; only the demo is labelled simulated.
          A real fan still waiting on a wallet gets no tag rather than a wrong one. */}
      {kind !== 'pending' && (
        <span
          style={{
            fontSize: 8.5,
            fontWeight: fw.black,
            letterSpacing: 0.5,
            color: 'var(--text-muted)',
            background: 'var(--surface-2)',
            padding: '2px 6px',
            borderRadius: 'var(--r-pill)',
          }}
        >
          {live ? t.mkDevnet : t.mkWalletSim}
        </span>
      )}
    </div>
  );
}

function StatTile({
  icon,
  value,
  label,
  line,
  fill,
  valueColor,
  action,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  line: string;
  fill: string;
  valueColor?: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 11,
        padding: '11px 13px',
        background: 'var(--surface-1)',
        border: `1px solid ${line}`,
        borderRadius: 'var(--r-xl)',
      }}
    >
      <div
        style={{
          flex: 'none',
          width: 36,
          height: 36,
          borderRadius: 'var(--r-lg)',
          background: fill,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: fw.black,
            fontStyle: 'italic',
            fontSize: 19,
            lineHeight: 'var(--leading-tight)',
            color: valueColor ?? 'var(--text-hi)',
          }}
        >
          {value}
        </div>
        <div
          style={{
            fontSize: 9.5,
            fontWeight: fw.heavy,
            letterSpacing: 0.4,
            color: 'var(--text-muted)',
            marginTop: 2,
          }}
        >
          {label}
        </div>
      </div>
      {action}
    </div>
  );
}

function StoreSoon() {
  const { t } = useI18n();
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        padding: '38px 14px 24px',
        animation: 'fadeUp .4s cubic-bezier(.2,.7,.3,1) both',
      }}
    >
      <div
        style={{
          width: 76,
          height: 76,
          borderRadius: 'var(--r-3xl)',
          background: 'var(--lime-a10)',
          border: '1px solid var(--lime-line)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Lock size={34} color="var(--lime)" />
      </div>
      <span
        style={{
          marginTop: 16,
          fontSize: 9.5,
          fontWeight: fw.black,
          letterSpacing: 1.2,
          color: 'var(--lime)',
          background: 'var(--lime-a10)',
          border: '1px solid var(--lime-line)',
          padding: '4px 10px',
          borderRadius: 'var(--r-pill)',
        }}
      >
        {t.mkSoonTag}
      </span>
      <div
        style={{
          fontWeight: fw.black,
          fontStyle: 'italic',
          fontSize: 22,
          letterSpacing: -0.5,
          marginTop: 12,
        }}
      >
        {t.mkSoonTitle}
      </div>
      <p
        style={{
          fontSize: 13.5,
          lineHeight: 'var(--leading-body)',
          fontWeight: fw.medium,
          color: 'var(--text-2)',
          marginTop: 8,
          maxWidth: 290,
        }}
      >
        {t.mkSoonBody}
      </p>
    </div>
  );
}

function FeaturedCard({ perk, onClick }: { perk: Perk; onClick: () => void }) {
  const { t } = useI18n();
  const copy = t.mkPerks[perk.id];

  return (
    <button
      onClick={onClick}
      style={{
        all: 'unset',
        cursor: 'pointer',
        boxSizing: 'border-box',
        display: 'block',
        width: '100%',
        marginTop: 14,
        padding: 18,
        borderRadius: 'var(--r-3xl)',
        background: `linear-gradient(150deg, ${softOf('var(--gold)', 16)}, var(--surface-1) 62%)`,
        border: `1.5px solid ${softOf('var(--gold)', 45)}`,
      }}
    >
      <span style={{ fontSize: 9.5, fontWeight: fw.black, letterSpacing: 1, color: 'var(--gold)' }}>
        {t.mkFeaturedTag}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 12 }}>
        <div
          style={{
            flex: 'none',
            width: 58,
            height: 58,
            borderRadius: 'var(--r-xl)',
            background: softOf('var(--gold)', 16),
            border: `1px solid ${softOf('var(--gold)', 45)}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <PerkIcon name={perk.icon} size={28} color="var(--gold)" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: fw.black, fontStyle: 'italic', fontSize: 19, letterSpacing: -0.3 }}>
            {copy.title}
          </div>
          <div
            style={{
              fontSize: 12.5,
              fontWeight: fw.medium,
              color: 'var(--text-2)',
              marginTop: 3,
              lineHeight: 1.35,
            }}
          >
            {copy.sub}
          </div>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          marginTop: 15,
          paddingTop: 13,
          borderTop: `1px solid ${softOf('var(--gold)', 28)}`,
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            fontWeight: fw.heavy,
            color: 'var(--gold)',
          }}
        >
          <ShieldCheck color="var(--gold)" />
          {t.mkOnChain}
        </span>
        <span style={{ fontWeight: fw.black, fontSize: 16, color: 'var(--gold)', whiteSpace: 'nowrap' }}>
          {perk.price} {currencyLabel(perk.currency, t, perk.price)}
        </span>
      </div>
    </button>
  );
}

function PerkCard({ perk, owned, onClick }: { perk: Perk; owned: boolean; onClick: () => void }) {
  const { t, fmt } = useI18n();
  const copy = t.mkPerks[perk.id];
  const tone = rarityTone(perk.rarity);

  return (
    <button
      onClick={onClick}
      style={{
        all: 'unset',
        cursor: 'pointer',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: 14,
        borderRadius: 'var(--r-2xl)',
        background: 'var(--surface-1)',
        border: `1px solid ${owned ? 'var(--lime-line)' : 'var(--border-1)'}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div
          style={{
            flex: 'none',
            width: 44,
            height: 44,
            borderRadius: 'var(--r-lg)',
            background: tone.soft,
            border: `1px solid ${tone.line}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <PerkIcon name={perk.icon} size={20} color={tone.color} />
        </div>
        <span
          style={{
            fontSize: 8,
            fontWeight: fw.black,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            color: tone.color,
            background: tone.soft,
            border: `1px solid ${tone.line}`,
            padding: '3px 7px',
            borderRadius: 'var(--r-pill)',
          }}
        >
          {owned ? t.mkOwnedTag : rarityLabel(perk.rarity, t)}
        </span>
      </div>
      <div style={{ fontWeight: fw.heavy, fontSize: 14, marginTop: 11, lineHeight: 1.22 }}>
        {copy.title}
      </div>
      <div
        style={{
          fontSize: 11.5,
          fontWeight: fw.medium,
          color: 'var(--text-muted)',
          marginTop: 4,
          lineHeight: 1.35,
          flex: 1,
        }}
      >
        {copy.sub}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
        <span style={{ fontWeight: fw.black, fontSize: 14.5, color: currencyColor(perk.currency) }}>
          {perk.currency === 'xp' ? fmt(perk.price) : perk.price}{' '}
          <span style={{ fontSize: 10.5, fontWeight: fw.heavy }}>{currencyLabel(perk.currency, t, perk.price)}</span>
        </span>
        {perk.verifiable && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 21,
              height: 21,
              borderRadius: 'var(--r-sm)',
              background: 'var(--lime-a10)',
            }}
          >
            <ShieldCheck size={12} />
          </span>
        )}
      </div>
    </button>
  );
}

function CollectionRow({
  icon,
  tone,
  title,
  sub,
  rarity,
  action,
  note,
}: {
  icon: React.ReactNode;
  tone: { color: string; soft: string; line: string };
  title: string;
  sub: string;
  rarity: string;
  action?: React.ReactNode;
  note?: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 13,
        padding: '13px 14px',
        borderRadius: 'var(--r-2xl)',
        background: 'var(--surface-1)',
        border: `1px solid ${tone.line}`,
      }}
    >
      <div
        style={{
          flex: 'none',
          width: 48,
          height: 48,
          borderRadius: 'var(--r-lg)',
          background: tone.soft,
          border: `1px solid ${tone.line}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: fw.heavy, fontSize: 14.5, lineHeight: 1.2 }}>{title}</div>
        <div style={{ fontSize: 11.5, fontWeight: fw.medium, color: 'var(--text-muted)', marginTop: 2 }}>
          {sub}
        </div>
        <span
          style={{
            display: 'inline-block',
            marginTop: 8,
            fontSize: 8,
            fontWeight: fw.black,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            color: tone.color,
            background: tone.soft,
            border: `1px solid ${tone.line}`,
            padding: '2px 7px',
            borderRadius: 'var(--r-pill)',
          }}
        >
          {rarity}
        </span>
      </div>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center' }}>
        {action}
        {note && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 11,
              fontWeight: fw.heavy,
              color: 'var(--lime)',
            }}
          >
            <span
              aria-hidden="true"
              style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--lime)' }}
            />
            {note}
          </span>
        )}
      </div>
    </div>
  );
}

function TrophySheet({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();

  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 30,
        background: 'color-mix(in srgb, var(--bg-app) 76%, transparent)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        animation: 'fadeUp .18s ease both',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.mkTrophyTitle}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 322,
          background: 'var(--surface-1)',
          border: '1px solid var(--border-2)',
          borderRadius: 'var(--r-3xl)',
          padding: 22,
          boxShadow: 'var(--shadow-pop)',
          animation: 'popIn .3s cubic-bezier(.2,.9,.3,1.2) both',
        }}
      >
        <div
          style={{
            width: 54,
            height: 54,
            borderRadius: 'var(--r-lg)',
            background: softOf('var(--gold)', 14),
            border: `1px solid ${softOf('var(--gold)', 45)}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Trophy size={28} />
        </div>
        <div
          style={{
            fontWeight: fw.black,
            fontStyle: 'italic',
            fontSize: 21,
            letterSpacing: -0.4,
            marginTop: 16,
          }}
        >
          {t.mkTrophyTitle}
        </div>
        <p
          style={{
            fontSize: 13.5,
            lineHeight: 'var(--leading-body)',
            fontWeight: fw.medium,
            color: 'var(--text-2)',
            marginTop: 9,
          }}
        >
          {t.mkTrophyBody}
        </p>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 14,
            padding: '11px 13px',
            borderRadius: 'var(--r-xl)',
            background: softOf('var(--gold)', 10),
            border: `1px solid ${softOf('var(--gold)', 40)}`,
          }}
        >
          <Trophy size={15} />
          <span style={{ fontSize: 11.5, fontWeight: fw.heavy, color: 'var(--gold)' }}>{t.mkGoldDesc}</span>
        </div>
        <div style={{ marginTop: 16 }}>
          <Button full onClick={onClose}>
            {t.mkTrophyGot}
          </Button>
        </div>
      </div>
    </div>
  );
}

