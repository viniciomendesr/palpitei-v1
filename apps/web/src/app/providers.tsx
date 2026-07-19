'use client';

import type { ReactNode } from 'react';
import { I18nProvider } from '@/lib/i18n';
import { SessionProvider } from '@/lib/session';
import { PrivyIsland } from '@/components/privy/PrivyIsland';
import { DemoPlayProvider } from '@/components/demo/DemoPlay';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <PrivyIsland>
      <SessionProvider>
        <I18nProvider>
          {/* Above the routes so the demo run survives sala → home → summary.
              In-memory only: it never fetches and never reaches Postgres. */}
          <DemoPlayProvider>{children}</DemoPlayProvider>
        </I18nProvider>
      </SessionProvider>
    </PrivyIsland>
  );
}
