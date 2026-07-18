'use client';

import { fw } from '@/lib/tokens';

interface LogoProps {
  size?: number;
  glow?: boolean;
}

export function Logo({ size = 34, glow = false }: LogoProps) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        background: 'var(--lime)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: 'rotate(-6deg)',
        flex: 'none',
        ...(glow ? { boxShadow: 'var(--shadow-logo)' } : {}),
      }}
      aria-hidden="true"
    >
      <span
        style={{
          fontSize: size * 0.5,
          fontWeight: fw.black,
          fontStyle: 'italic',
          color: 'var(--on-lime)',
          letterSpacing: size > 50 ? -2 : -0.5,
          lineHeight: 1,
        }}
      >
        P!
      </span>
    </div>
  );
}

export function Wordmark({ size = 19 }: { size?: number }) {
  return (
    <span
      style={{
        fontWeight: fw.black,
        fontStyle: 'italic',
        fontSize: size,
        letterSpacing: size > 25 ? -1 : -0.5,
        color: 'var(--text-hi)',
      }}
    >
      PALPITEI
    </span>
  );
}
