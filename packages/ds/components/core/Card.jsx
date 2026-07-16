import React from 'react';
export function Card({ elevated = false, glow = false, children, style, ...rest }) {
  return <div style={{ background: elevated ? 'var(--surface-2)' : 'var(--surface-1)', border: '1px solid ' + (elevated ? 'var(--lime-a30)' : 'var(--border-1)'), borderRadius: 'var(--r-2xl)', padding: 16, ...(glow ? { animation: 'glow 2.4s infinite' } : {}), ...style }} {...rest}>{children}</div>;
}