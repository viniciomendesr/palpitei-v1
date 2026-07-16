import React from 'react';
export function Toggle({ checked = false, onChange }) {
  return <button onClick={() => onChange && onChange(!checked)} style={{ width: 48, height: 28, borderRadius: 'var(--r-pill)', border: 'none', cursor: 'pointer', padding: 3, display: 'flex', alignItems: 'center', background: checked ? 'var(--lime)' : 'rgba(255,255,255,.14)', justifyContent: checked ? 'flex-end' : 'flex-start', transition: 'all .2s' }}><span style={{ width: 22, height: 22, borderRadius: '50%', background: '#fff', display: 'block' }} /></button>;
}