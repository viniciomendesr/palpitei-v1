'use client';

/**
 * Os provedores do app, na ordem em que dependem uns dos outros:
 *
 *   PrivyIsland  → a identidade (o DID) e o Bearer do cliente REST
 *   SessionProvider → o estado do fã (apelido, XP, ligas)
 *   I18nProvider → pt/en
 *
 * A sessão fica por dentro da Privy porque, quando a ilha for implementada, é o
 * DID verificado que vai popular a sessão — nunca o contrário.
 */

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
