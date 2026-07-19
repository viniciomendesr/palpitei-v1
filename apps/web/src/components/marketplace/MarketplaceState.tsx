'use client';

/**
 * Marketplace state, shared by the store, the perk detail and the seal proof screens.
 *
 * It is mounted by the `/marketplace` layout, which persists across its child routes, so
 * navigating store → perk → proof keeps the demo balances instead of resetting them.
 *
 * Everything here is local React state and nothing in this subtree issues a request:
 * redeeming and minting are simulated for the demo account (rule 3), and a real fan has
 * no store to act on in the first place (rule 4).
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import {
  DEMO_TROPHIES,
  canAfford,
  type Balances,
  type Perk,
  type PerkId,
} from '@/lib/marketplace';

export interface ToastContent {
  title: string;
  sub: string;
}

interface MarketplaceValue {
  /** The demo account is the only one with a populated store. */
  isDemo: boolean;
  balances: Balances;
  ownedPerks: ReadonlySet<PerkId>;
  /** Local mint timestamps, keyed by pick id. */
  mintedPicks: Readonly<Record<string, number>>;
  toast: ToastContent | null;
  showToast: (content: ToastContent) => void;
  /** Spends the price and marks the perk owned. Returns false when unaffordable. */
  redeem: (perk: Perk) => boolean;
  /** Spends one trophy and records the mint. Returns false when unaffordable. */
  mintPick: (pickId: string) => boolean;
}

const MarketplaceContext = createContext<MarketplaceValue | null>(null);

/** How long a confirmation toast stays on screen. */
const TOAST_MS = 2_600;

export function MarketplaceProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const { t } = useI18n();

  const isDemo = session?.authMethod === 'demo';

  // A real fan has no store, so their balances only ever mirror the account.
  const [spentXp, setSpentXp] = useState(0);
  const [spentTrophies, setSpentTrophies] = useState(0);
  const [ownedPerks, setOwnedPerks] = useState<ReadonlySet<PerkId>>(() => new Set());
  const [mintedPicks, setMintedPicks] = useState<Record<string, number>>({});
  const [toast, setToast] = useState<ToastContent | null>(null);

  const balances = useMemo<Balances>(
    () => ({
      xp: Math.max(0, (session?.xp ?? 0) - spentXp),
      trophies: Math.max(0, (isDemo ? DEMO_TROPHIES : 0) - spentTrophies),
    }),
    [session?.xp, spentXp, spentTrophies, isDemo],
  );

  const showToast = useCallback((content: ToastContent) => {
    setToast(content);
    window.setTimeout(() => setToast((atual) => (atual === content ? null : atual)), TOAST_MS);
  }, []);

  const spend = useCallback((perk: Perk) => {
    if (perk.currency === 'trophy') setSpentTrophies((n) => n + perk.price);
    else setSpentXp((n) => n + perk.price);
  }, []);

  const redeem = useCallback(
    (perk: Perk) => {
      if (!isDemo || !canAfford(perk, balances)) return false;
      spend(perk);
      setOwnedPerks((atual) => new Set(atual).add(perk.id));
      showToast({ title: t.mkRedeemedTitle, sub: t.mkRedeemedSub });
      return true;
    },
    [isDemo, balances, spend, showToast, t.mkRedeemedTitle, t.mkRedeemedSub],
  );

  const mintPick = useCallback(
    (pickId: string) => {
      if (!isDemo || balances.trophies < 1) return false;
      setSpentTrophies((n) => n + 1);
      setMintedPicks((atual) => ({ ...atual, [pickId]: Date.now() }));
      showToast({ title: t.mkMintedTitle, sub: t.mkMintedSub });
      return true;
    },
    [isDemo, balances.trophies, showToast, t.mkMintedTitle, t.mkMintedSub],
  );

  const value = useMemo<MarketplaceValue>(
    () => ({ isDemo, balances, ownedPerks, mintedPicks, toast, showToast, redeem, mintPick }),
    [isDemo, balances, ownedPerks, mintedPicks, toast, showToast, redeem, mintPick],
  );

  return <MarketplaceContext.Provider value={value}>{children}</MarketplaceContext.Provider>;
}

export function useMarketplace(): MarketplaceValue {
  const ctx = useContext(MarketplaceContext);
  if (!ctx) throw new Error('useMarketplace precisa estar dentro do layout de /marketplace.');
  return ctx;
}
