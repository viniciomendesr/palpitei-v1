---
category: Core
---

The app shell. Wrap every screen in exactly one `AppFrame` at the root — it is the only
layout element that reacts to viewport size, and it replaces the hand-rolled
`<div style={{minHeight:'100vh', background:'var(--bg-app)'}}>` root.

Palpitei is **mobile-first and ships one layout: the phone.** Never build a separate desktop
screen, a wider variant, or a multi-column view.

- **Phone** (< 480px): the frame *is* the screen — 100% width, square corners, no shadow, no bezel
  (the real device is already the bezel).
- **Desktop** (≥ 480px): the content is **not stretched**. The same phone layout is centred in a
  420px screen (`--app-max-w`) at full viewport height, held in a light smartphone body — a 10px
  `--app-bezel` in `--app-bezel-bg`, with concentric corners (28px screen / 38px body) and a
  `--border-2` rim — lifted by a neutral shadow (`--shadow-frame`) over an `--app-backdrop`
  letterbox filling the rest.

The bezel is decoration around the app, never part of it: `--app-max-w` measures the **screen**, so
the layout inside is identical at both sizes and nothing you build has to know the bezel exists.

```jsx
<AppFrame>
  <Home />
</AppFrame>
```

It also gives you, for free — don't re-implement these on the screen inside:

- **Background, text colour and font** (`--bg-app`, `--text-hi`, `--font-sans`).
- **Scrolling**: an internal scroll region with momentum scrolling and `overscroll-behavior:
  contain`, so a bottom sheet or list never scroll-chains to the page behind it.
- **Safe areas**: `env(safe-area-inset-*)` padding, so content clears the notch and home indicator.
- **Clipping**: `overflow: hidden` on the frame — nothing leaks past the rounded corners.

Screens inside should size to the frame with `minHeight: '100%'`, **not** `100vh` — inside the
frame, `100vh` is the whole browser window and will overflow on desktop.

```jsx
// A screen, as it should be written:
<AppFrame>
  <div style={{ minHeight: '100%', padding: 'var(--gutter)' }}>…</div>
</AppFrame>
```

Set `scroll={false}` only when the screen owns its own scrolling (a fixed header plus an
independently scrolling body, say). The frame still clips either way. `maxWidth` overrides the
column width for a deliberate exception — it is not the way to build a desktop layout.
