import React from 'react';
export function AppFrame({ maxWidth, scroll = true, contentStyle, children, style, ...rest }) {
  const screenW = typeof maxWidth === 'number' ? maxWidth + 'px' : (maxWidth ?? 'var(--app-max-w)');
  return (
    <div style={{ background: 'var(--app-backdrop)', height: 'var(--app-vh)', display: 'flex', justifyContent: 'center', alignItems: 'var(--app-frame-align)', padding: 'var(--app-frame-gap)', boxSizing: 'border-box', overflow: 'hidden', ...style }} {...rest}>
      {/* Device body. Collapses to a passthrough on phones, where every token below is 0/transparent. */}
      {/* The rim is an outline, not a border: a border would eat 2px of the app column under
          border-box (420 -> 418) and leave a 1px backdrop seam down each edge full-bleed. */}
      {/* height + max-height, not stretch: a phone has a fixed shape. Left to stretch, the
          device inherited the window's height and rendered a 1:2.5 ribbon that resized on
          browser zoom. height:100% keeps it filling a short window; --app-frame-max-h stops
          it growing past the phone's proportion on a tall one. On phones the max is `none`,
          so this collapses back to full-bleed. */}
      <div style={{ display: 'flex', width: '100%', height: '100%', maxWidth: `calc(${screenW} + 2 * var(--app-bezel))`, maxHeight: 'var(--app-frame-max-h)', boxSizing: 'border-box', padding: 'var(--app-bezel)', background: 'var(--app-bezel-bg)', outline: '1px solid var(--app-frame-border)', outlineOffset: '-1px', borderRadius: 'var(--app-bezel-radius)', boxShadow: 'var(--app-frame-shadow)' }}>
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', width: '100%', boxSizing: 'border-box', background: 'var(--bg-app)', color: 'var(--text-hi)', fontFamily: 'var(--font-sans)', borderRadius: 'var(--app-frame-radius)', overflow: 'hidden', ...contentStyle }}>
          {scroll ? <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain', paddingTop: 'env(safe-area-inset-top,0px)', paddingBottom: 'env(safe-area-inset-bottom,0px)', paddingLeft: 'env(safe-area-inset-left,0px)', paddingRight: 'env(safe-area-inset-right,0px)' }}>{children}</div> : children}
        </div>
      </div>
    </div>
  );
}
