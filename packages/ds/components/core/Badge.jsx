import React from 'react';
export function Badge({ tone = 'lime', dot = false, children, ...rest }) {
  const tones = {
    lime: { color: 'var(--lime)', bg: 'var(--lime-a14)', bd: 'var(--lime-line)' },
    solid: { color: 'var(--on-lime)', bg: 'var(--lime)', bd: 'transparent' },
    neutral: { color: 'var(--text-2)', bg: 'var(--surface-2)', bd: 'var(--border-2)' },
    live: { color: 'var(--red)', bg: 'transparent', bd: 'transparent' },
  };
  const t = tones[tone] || tones.lime;
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 900, letterSpacing: .5, color: t.color, background: t.bg, border: '1px solid ' + t.bd, borderRadius: 8, padding: '4px 8px', fontFamily: 'var(--font-sans)' }} {...rest}>{dot && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', boxShadow: 'var(--glow-dot)' }} />}{children}</span>;
}