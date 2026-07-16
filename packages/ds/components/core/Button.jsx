import React from 'react';
export function Button({ variant = 'primary', size = 'md', full = false, children, style, ...rest }) {
  const base = { fontFamily: 'var(--font-sans)', fontWeight: 900, border: 'none', cursor: 'pointer', borderRadius: 'var(--r-xl)', transition: 'transform .15s', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, whiteSpace: 'nowrap' };
  const sizes = { sm: { height: 40, padding: '0 16px', fontSize: 13.5, borderRadius: 'var(--r-md)' }, md: { height: 54, padding: '0 22px', fontSize: 16 }, lg: { height: 56, padding: '0 24px', fontSize: 16.5 } };
  const variants = {
    primary: { background: 'var(--lime)', color: 'var(--on-lime)', boxShadow: 'var(--shadow-btn)' },
    secondary: { background: 'transparent', color: 'var(--text-hi)', border: '1.5px solid var(--border-2)' },
    ghost: { background: 'transparent', color: 'var(--text-2)', border: '1.5px solid var(--border-2)', fontWeight: 700 },
    danger: { background: 'transparent', color: 'var(--red-soft)', border: '1.5px solid rgba(255,90,90,.4)', fontWeight: 800 },
  };
  return <button style={{ ...base, ...sizes[size], ...variants[variant], ...(full ? { width: '100%' } : {}), ...style }} {...rest}>{children}</button>;
}