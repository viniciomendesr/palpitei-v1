import React from 'react';
export function ProgressBar({ value = 0, tone = 'lime' }) {
  const c = tone === 'lime' ? 'var(--lime)' : tone;
  return <div style={{ height: 8, borderRadius: 'var(--r-pill)', background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}><div style={{ height: '100%', borderRadius: 'var(--r-pill)', background: c, width: Math.max(0, Math.min(100, value)) + '%', transition: 'width .6s' }} /></div>;
}