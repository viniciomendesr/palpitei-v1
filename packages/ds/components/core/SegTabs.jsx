import React from 'react';
export function SegTabs({ tabs = [], value, onChange }) {
  return <div style={{ display: 'flex', gap: 8 }}>{tabs.map(t => {
    const a = t.value === value;
    return <button key={t.value} onClick={() => onChange && onChange(t.value)} style={{ height: 38, padding: '0 16px', borderRadius: 'var(--r-pill)', border: 'none', fontFamily: 'var(--font-sans)', fontSize: 13.5, fontWeight: 800, cursor: 'pointer', background: a ? 'var(--lime)' : 'var(--surface-2)', color: a ? 'var(--on-lime)' : 'var(--text-2)', display: 'inline-flex', alignItems: 'center', gap: 7 }}>{t.label}</button>;
  })}</div>;
}