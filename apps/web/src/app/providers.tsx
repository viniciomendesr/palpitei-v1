'use client';

import type { ReactNode } from 'react';
import { I18nProvider } from '@/lib/i18n';
import { SessionProvider } from '@/lib/session';
import { PrivyIsland } from '@/components/privy/PrivyIsland';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <PrivyIsland>
      <SessionProvider>
        <I18nProvider>{children}</I18nProvider>
      </SessionProvider>
    </PrivyIsland>
  );
}
