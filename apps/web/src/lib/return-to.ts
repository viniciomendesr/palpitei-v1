const KEY = 'palpitei.returnTo';

export function safeReturnTo(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
  try {
    const parsed = new URL(value, 'https://palpitei.local');
    if (parsed.origin !== 'https://palpitei.local') return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function setPendingReturnTo(value: string): void {
  const safe = safeReturnTo(value);
  if (safe && typeof window !== 'undefined') window.sessionStorage.setItem(KEY, safe);
}

export function peekPendingReturnTo(): string | null {
  if (typeof window === 'undefined') return null;
  return safeReturnTo(window.sessionStorage.getItem(KEY));
}

export function consumePendingReturnTo(fallback = '/home'): string {
  const value = peekPendingReturnTo();
  if (typeof window !== 'undefined') window.sessionStorage.removeItem(KEY);
  return value ?? fallback;
}
