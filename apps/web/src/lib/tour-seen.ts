/**
 * First-visit gate for the pre-login tour.
 *
 * The flag lives in localStorage rather than in the session: the tour runs *before*
 * authentication, so there is no account to hang it on, and a fan who skips it must
 * not see it again on the next visit.
 *
 * Reads are defensive because Safari's private mode throws on localStorage access
 * instead of returning null — an unhandled throw here would take the login screen,
 * and with it the demo path, down with it.
 */

const KEY = 'palpitei.tour.seen.v1';

export function tourSeen(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    // Storage denied: treat the tour as seen so the login screen still renders.
    return true;
  }
}

export function markTourSeen(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, '1');
  } catch {
    // Nothing to do — the tour simply runs again next time.
  }
}
