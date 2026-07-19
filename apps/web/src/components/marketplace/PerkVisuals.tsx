'use client';

/** Shared marketplace visuals: perk icons, rarity tones and currency labels. */

import {
  Drop,
  Flag,
  Frame,
  Seal,
  Shield,
  Shirt,
  Star,
  Tag,
  Ticket,
  Unlock,
  Users,
} from '@/components/Icons';
import type { Dict } from '@/lib/i18n';
import type { PerkCurrency, PerkIconName, PerkRarity } from '@/lib/marketplace';
import { fw } from '@/lib/tokens';

/** Base colour per rarity; the soft fill and hairline derive from it. */
const RARITY_COLOR: Record<PerkRarity, string> = {
  common: 'var(--text-muted)',
  rare: 'var(--blue)',
  epic: 'var(--pink)',
  legendary: 'var(--gold)',
};

/** Mixing keeps the translucent fills on tokens instead of hardcoded rgba. */
export function softOf(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

export interface RarityTone {
  color: string;
  soft: string;
  line: string;
}

export function rarityTone(rarity: PerkRarity): RarityTone {
  const color = RARITY_COLOR[rarity];
  return { color, soft: softOf(color, 12), line: softOf(color, 42) };
}

export function rarityLabel(rarity: PerkRarity, t: Dict): string {
  return rarity === 'legendary'
    ? t.mkRarLegendary
    : rarity === 'epic'
      ? t.mkRarEpic
      : rarity === 'rare'
        ? t.mkRarRare
        : t.mkRarCommon;
}

export function currencyColor(currency: PerkCurrency): string {
  return currency === 'trophy' ? 'var(--gold)' : 'var(--lime)';
}

/** Trophies are counted, so the unit label agrees with the amount. */
export function currencyLabel(currency: PerkCurrency, t: Dict, amount = 1): string {
  if (currency !== 'trophy') return t.mkCurXp;
  return amount > 1 ? t.mkCurTrophies : t.mkCurTrophy;
}

const ICONS: Record<PerkIconName, (p: { size?: number; color?: string }) => React.JSX.Element> = {
  seal: Seal,
  unlock: Unlock,
  ticket: Ticket,
  tag: Tag,
  shirt: Shirt,
  shield: Shield,
  frame: Frame,
  drop: Drop,
  star: Star,
  users: Users,
  flag: Flag,
};

/** Confirmation banner for the simulated redeem/mint actions. */
export function MarketToast({ title, sub }: { title: string; sub: string }) {
  return (
    <div
      role="status"
      style={{
        position: 'absolute',
        left: 18,
        right: 18,
        bottom: 22,
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '13px 16px',
        borderRadius: 'var(--r-xl)',
        background: 'var(--surface-2)',
        border: '1px solid var(--lime-line)',
        boxShadow: 'var(--shadow-toast)',
        animation: 'fadeUp .3s ease both',
      }}
    >
      <span style={{ fontWeight: fw.heavy, fontSize: 13.5, color: 'var(--text-hi)' }}>
        {title}
      </span>
      {sub && (
        <span style={{ fontSize: 12, fontWeight: fw.medium, color: 'var(--text-2)' }}>
          {sub}
        </span>
      )}
    </div>
  );
}

export function PerkIcon({
  name,
  size = 20,
  color,
}: {
  name: PerkIconName;
  size?: number;
  color?: string;
}) {
  const Glyph = ICONS[name];
  return <Glyph size={size} color={color} />;
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: fw.black,
        letterSpacing: 1,
        color: 'var(--text-faint)',
        margin: '22px 0 10px',
      }}
    >
      {children}
    </div>
  );
}

export function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border-1)',
        borderRadius: 'var(--r-2xl)',
        padding: 16,
      }}
    >
      {children}
    </div>
  );
}

export function FieldRow({
  label,
  value,
  last = false,
  muted = false,
}: {
  label: string;
  value: string;
  last?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      style={{
        paddingBottom: last ? 0 : 12,
        marginBottom: last ? 0 : 12,
        borderBottom: last ? undefined : '1px solid var(--border-1)',
      }}
    >
      <div
        style={{
          fontSize: 'var(--micro)',
          fontWeight: fw.black,
          letterSpacing: 'var(--tracking-label)',
          color: 'var(--text-faint)',
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 13.5,
          fontWeight: fw.bold,
          color: muted ? 'var(--text-muted)' : 'var(--text-1)',
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </div>
    </div>
  );
}
