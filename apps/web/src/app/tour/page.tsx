'use client';

/**
 * Pre-login tour, on its own route so it is reachable at any time — including by a
 * fan whose browser already holds a session. Living inside the login screen made it
 * lose a race with the authenticated redirect and never render.
 */

import { useRouter } from 'next/navigation';
import { Screen } from '@/components/Shell';
import { Tour } from '@/components/Tour';
import { markTourSeen } from '@/lib/tour-seen';

export default function TourPage() {
  const router = useRouter();

  const done = () => {
    markTourSeen();
    // Back to the entry point, which now knows the tour is done and resumes whatever
    // redirect the fan's session calls for.
    router.replace('/');
  };

  return (
    <Screen style={{ display: 'flex', flexDirection: 'column', padding: 0 }}>
      <Tour onDone={done} />
    </Screen>
  );
}
