import React from 'react';
export function Chip({ children, ...rest }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--surface-2)', border: '1px solid var(--lime-line)', borderRadius: 'var(--r-pill)', padding: '7px 12px', fontSize: 12.5, fontWeight: 800, color: 'var(--text-hi)', fontFamily: 'var(--font-sans)' }} {...rest}>{children}</span>;
}