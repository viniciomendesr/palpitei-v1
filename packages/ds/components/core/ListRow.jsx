import React from 'react';
export function ListRow({ title, subtitle, trailing = '\u203a', onClick }) {
  return <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, width: '100%', minHeight: 56, padding: '12px 16px', borderRadius: 'var(--r-lg)', border: '1px solid var(--border-1)', background: 'var(--surface-1)', cursor: onClick ? 'pointer' : 'default', fontFamily: 'var(--font-sans)', textAlign: 'left' }}>
    <div><div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-1)' }}>{title}</div>{subtitle && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, marginTop: 2 }}>{subtitle}</div>}</div>
    {trailing && <span style={{ color: 'var(--text-faint)', fontSize: 20 }}>{trailing}</span>}
  </button>;
}