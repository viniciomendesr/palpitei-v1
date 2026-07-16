'use client';

/**
 * Bandeiras — desenhadas em CSS, como o resto da iconografia (sem emoji, sem <img>).
 *
 * Sobre os hex literais aqui: a regra "nunca hardcode hex" vale pros tokens do
 * DESIGN (superfície, texto, acento) — trocar --lime tem que repintar o app.
 * A cor de uma bandeira nacional é CONTEÚDO, não tema: o azul da Argentina não é
 * um token e não muda se a paleta mudar. Tokenizar isso seria mentira.
 *
 * Só as duas da sala de demonstração existem por enquanto. Quando as fixtures
 * reais entrarem, isto vira um mapa por código de país.
 */

interface FlagProps {
  width?: number;
  height?: number;
}

/** Argentina — três faixas horizontais. */
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

/** Cabo Verde — simplificada: três faixas verticais com a estrela ao centro. */
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
