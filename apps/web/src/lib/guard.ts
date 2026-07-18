'use client';

/**
 * Client-side route guard. It returns `false` until hydration finishes to avoid
 * an SSR/client mismatch; server-side Privy bearer validation remains authoritative.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from './session';

export function useRequireSession(): boolean {
  const { session, hydrated } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (hydrated && !session) router.replace('/');
  }, [hydrated, session, router]);

  return hydrated && !!session;
}
