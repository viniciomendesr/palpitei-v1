'use client';

interface FlagProps {
  width?: number;
  height?: number;
}

export function FlagArgentina({ width = 38, height = 26 }: FlagProps) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 'var(--r-sm)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        flex: 'none',
      }}
      aria-hidden="true"
    >
      <div style={{ flex: 1, background: '#75AADB' }} />
      <div style={{ flex: 1, background: '#fff' }} />
      <div style={{ flex: 1, background: '#75AADB' }} />
    </div>
  );
}

export function FlagCaboVerde({ width = 38, height = 26 }: FlagProps) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 'var(--r-sm)',
        overflow: 'hidden',
        display: 'flex',
        background: '#0b3d2e',
        flex: 'none',
      }}
      aria-hidden="true"
    >
      <div style={{ width: '33%', background: '#0b3d2e' }} />
      <div
        style={{
          width: '34%',
          background: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width={height * 0.42} height={height * 0.42} viewBox="0 0 24 24" fill="#c8102e">
          <path d="M12 2l2.4 6.9H21l-5.4 4.2 2 6.9L12 15.8 6.4 20l2-6.9L3 8.9h6.6L12 2z" />
        </svg>
      </div>
      <div style={{ width: '33%', background: '#c8102e' }} />
    </div>
  );
}
