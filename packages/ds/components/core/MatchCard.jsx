import React from 'react';
export function MatchCard({ status, group, teamA, teamB, scoreA, scoreB, cta, onClick, live = false }) {
  return <div onClick={onClick} style={{ background: live ? 'var(--surface-2)' : 'var(--surface-1)', border: '1.5px solid ' + (live ? 'var(--lime-a30)' : 'var(--border-1)'), borderRadius: 'var(--r-2xl)', padding: 16, cursor: onClick ? 'pointer' : 'default', fontFamily: 'var(--font-sans)' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 900, letterSpacing: 1, color: live ? 'var(--red)' : 'var(--text-muted)' }}>{live && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--red)', animation: 'pulse 1.2s infinite' }} />}{status}</span>
      <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-faint)' }}>{group}</span>
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
      <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--text-hi)' }}>{teamA}</span>
      <span style={{ fontWeight: 900, fontSize: 22, fontStyle: 'italic', letterSpacing: -1 }}>{scoreA} – {scoreB}</span>
      <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--text-hi)' }}>{teamB}</span>
    </div>
    {cta && <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><span style={{ fontSize: 12.5, fontWeight: 900, color: 'var(--on-lime)', background: 'var(--lime)', borderRadius: 'var(--r-pill)', padding: '7px 14px' }}>{cta}</span></div>}
  </div>;
}