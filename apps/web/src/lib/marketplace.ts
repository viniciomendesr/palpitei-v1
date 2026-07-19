/**
 * Marketplace domain: the perk catalogue plus the pure decisions the screens take.
 *
 * Two flows, deliberately (rule 4): a DEMO account renders the whole store so the judge
 * sees the vision, and a real fan gets the "coming soon" state plus an empty collection,
 * because there is no inventory to sell yet. Nothing in this module touches the network,
 * which is what keeps the demo path offline (rule 3).
 */

export type PerkCategory = 'featured' | 'game' | 'partners' | 'identity' | 'social';
export type PerkRarity = 'common' | 'rare' | 'epic' | 'legendary';
export type PerkCurrency = 'xp' | 'trophy';
export type PerkIconName =
  | 'seal'
  | 'unlock'
  | 'ticket'
  | 'tag'
  | 'shirt'
  | 'shield'
  | 'frame'
  | 'drop'
  | 'star'
  | 'users'
  | 'flag';

export type PerkId =
  | 'poc'
  | 'markets'
  | 'ticket'
  | 'discount'
  | 'product'
  | 'leaguebadge'
  | 'frame'
  | 'namecolor'
  | 'callerflair'
  | 'bigleague'
  | 'spotlight';

export interface Perk {
  id: PerkId;
  category: PerkCategory;
  rarity: PerkRarity;
  currency: PerkCurrency;
  price: number;
  /** Renders the on-chain verification seal. */
  verifiable: boolean;
  /** The single showcase card at the top of the featured category. */
  featured: boolean;
  icon: PerkIconName;
}

/** Copy lives in the dictionary (`mkPerks`); this is the structure only. */
export const PERKS: readonly Perk[] = [
  { id: 'poc', category: 'featured', rarity: 'legendary', currency: 'trophy', price: 1, verifiable: true, featured: true, icon: 'seal' },
  { id: 'markets', category: 'game', rarity: 'rare', currency: 'xp', price: 800, verifiable: false, featured: false, icon: 'unlock' },
  { id: 'ticket', category: 'partners', rarity: 'epic', currency: 'trophy', price: 2, verifiable: false, featured: false, icon: 'ticket' },
  { id: 'discount', category: 'partners', rarity: 'common', currency: 'xp', price: 400, verifiable: false, featured: false, icon: 'tag' },
  { id: 'product', category: 'partners', rarity: 'rare', currency: 'xp', price: 1200, verifiable: false, featured: false, icon: 'shirt' },
  { id: 'leaguebadge', category: 'identity', rarity: 'rare', currency: 'xp', price: 600, verifiable: true, featured: false, icon: 'shield' },
  { id: 'frame', category: 'identity', rarity: 'common', currency: 'xp', price: 300, verifiable: false, featured: false, icon: 'frame' },
  { id: 'namecolor', category: 'identity', rarity: 'common', currency: 'xp', price: 250, verifiable: false, featured: false, icon: 'drop' },
  { id: 'callerflair', category: 'identity', rarity: 'epic', currency: 'trophy', price: 1, verifiable: true, featured: false, icon: 'star' },
  { id: 'bigleague', category: 'social', rarity: 'rare', currency: 'xp', price: 900, verifiable: false, featured: false, icon: 'users' },
  { id: 'spotlight', category: 'social', rarity: 'epic', currency: 'trophy', price: 1, verifiable: false, featured: false, icon: 'flag' },
];

export const STORE_CATEGORIES: readonly PerkCategory[] = [
  'featured',
  'game',
  'partners',
  'identity',
  'social',
];

export function perkById(id: string): Perk | null {
  return PERKS.find((p) => p.id === id) ?? null;
}

/** The showcase card only exists on the featured chip. */
export function showsFeaturedCard(category: PerkCategory): boolean {
  return category === 'featured';
}

/**
 * Grid contents for a category. "Featured" is the whole catalogue minus the perk
 * already shown as the showcase card, so no perk is rendered twice on one screen.
 */
export function perksInCategory(category: PerkCategory): Perk[] {
  if (category === 'featured') return PERKS.filter((p) => !p.featured);
  return PERKS.filter((p) => p.category === category);
}

export interface Balances {
  xp: number;
  trophies: number;
}

export function canAfford(perk: Perk, balances: Balances): boolean {
  return perk.currency === 'trophy' ? balances.trophies >= perk.price : balances.xp >= perk.price;
}

export type StoreMode = 'full' | 'soon';

/** Only the demo account sees the populated store. */
export function storeMode(isDemo: boolean): StoreMode {
  return isDemo ? 'full' : 'soon';
}

/**
 * Detail screens exist for the demo flow only. A real fan reaching `/marketplace/perk/x`
 * by hand gets sent back rather than shown an item they cannot obtain.
 */
export function canOpenDetail(isDemo: boolean): boolean {
  return isDemo;
}

/** `7xKqABCDEF9fPz` renders as `7xKq…9fPz`. Short inputs stay whole. */
export function shortAddress(address: string, edge = 4): string {
  const clean = address.trim();
  if (clean.length <= edge * 2 + 1) return clean;
  return `${clean.slice(0, edge)}…${clean.slice(-edge)}`;
}

export type WalletChipKind = 'demo' | 'address' | 'pending';

export interface WalletChip {
  kind: WalletChipKind;
  /** Only present for a real wallet; never a placeholder. */
  address: string | null;
}

/**
 * What the header chip shows.
 *
 * A demo fan has no wallet and cannot reach the network, so the chip says so instead of
 * printing an address-shaped string. Showing `7xKq…9fPz` there would be a provenance
 * label that lies (G6).
 */
export function walletChip({
  isDemo,
  address,
}: {
  isDemo: boolean;
  address: string | null | undefined;
}): WalletChip {
  if (isDemo) return { kind: 'demo', address: null };
  const clean = address?.trim();
  if (!clean) return { kind: 'pending', address: null };
  return { kind: 'address', address: shortAddress(clean) };
}

/** A correct prediction the demo fan can turn into a TxLINE Seal. */
export interface EligiblePick {
  id: string;
  matchKey: 'demoMatch';
  marketKey: 'demoMarket';
  predictionKey: 'demoPrediction';
}

/**
 * The demo's only eligible prediction, drawn from the guided replay whose football facts
 * are public FIFA record (CONTEXT §13). Nothing about the match is invented here.
 */
export const DEMO_ELIGIBLE_PICK: EligiblePick = {
  id: 'call-201',
  matchKey: 'demoMatch',
  marketKey: 'demoMarket',
  predictionKey: 'demoPrediction',
};

/** Trophies the demo account holds: the debut award, once per account. */
export const DEMO_TROPHIES = 1;
