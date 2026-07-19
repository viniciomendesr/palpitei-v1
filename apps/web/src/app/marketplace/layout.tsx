'use client';

/**
 * A layout persists across its child routes, so mounting the marketplace state here keeps
 * the demo balances alive while the fan moves between store, perk detail and proof.
 */

import type { ReactNode } from 'react';
import { MarketplaceProvider } from '@/components/marketplace/MarketplaceState';

export default function MarketplaceLayout({ children }: { children: ReactNode }) {
  return <MarketplaceProvider>{children}</MarketplaceProvider>;
}
