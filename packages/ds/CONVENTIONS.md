# Building with Palpitei

Palpitei is a live-football prediction game (Copa do Mundo 2026). The look is near-black green
surfaces, one electric-lime accent, and italic-900 Archivo for anything loud.

## Mobile-first, dark-only: wrap everything in AppFrame

**Palpitei is a phone app and ships exactly one layout — the phone.** There is no desktop design.
Never build a desktop screen, a wide variant, a sidebar, or a multi-column view; never stretch
content to the viewport. On a big screen the *same* phone layout is centred in a 420px column
against a neutral letterbox, and that is the entire desktop story.

`AppFrame` is the one wrapper that makes this happen. It is a layout wrapper, not a context
provider — the components are self-styled and read tokens straight from `:root` — but every screen
still goes inside exactly one, at the root:

```jsx
<AppFrame>
  <Home />
</AppFrame>
```

That single wrap gives you: the dark app surface, text colour and font (`--bg-app`, `--text-hi`,
`--font-sans`); on desktop the 420px screen centred in a light smartphone body (10px bezel,
concentric corners, neutral shadow), full-bleed and square on phones; the scroll region (momentum
scrolling, contained overscroll); `env(safe-area-inset-*)` padding for notch and home indicator; and
`overflow: hidden` so nothing escapes the frame. **Don't hand-roll any of it** — no
`minHeight: '100vh'` root div, no manual centring, no `max-width` wrapper of your own.

The bezel is chrome *around* the app, never part of it — `--app-max-w` measures the screen, so what
you build is identical at both sizes and never needs to know the bezel exists.

Two rules that follow from it:

- **Inside the frame, size to `minHeight: '100%'` — never `100vh`.** `100vh` is the whole browser
  window, which overflows the frame on desktop.
- Every component uses light foreground tokens, so a light page renders the outline/ghost/neutral
  variants invisible. Never introduce a light theme — there isn't one, and no token supports it.

## Styling idiom: tokens, not classes

**This design system ships zero CSS classes.** Don't look for a utility vocabulary and don't invent
one. Components are configured by props; everything you build around them is styled with
`var(--*)` tokens via inline `style` or your own CSS. Never hardcode a hex, radius, or font.

| Family | Use the tokens |
|---|---|
| Surfaces (dark→light) | `--app-backdrop` (desktop letterbox, behind the frame) `--bg-page` `--bg-app` `--surface-sunken` `--surface-1` `--surface-2` `--surface-row` `--surface-header` `--surface-disabled` |
| App frame | Owned by `AppFrame` — read them, don't re-implement: `--app-max-w` (420px, the **screen**) `--app-vh` (viewport height, dvh-aware) `--app-frame-max-h` (912px on desktop — the device has a SHAPE; without it the body inherits the window height and renders a 1:2.5 ribbon that resizes on browser zoom) `--app-frame-align` `--app-frame-radius` `--app-frame-shadow` `--app-frame-border` `--app-frame-gap`; the desktop smartphone body is `--app-bezel` (10px) `--app-bezel-bg` `--app-bezel-radius` (concentric: screen radius + bezel). Mobile-first defaults are the phone — bezel 0, square, no shadow, no height cap, full-bleed. The desktop treatment is gated on `(min-width:480px) and (hover:hover) and (pointer:fine)`: **width alone is not "desktop"** — a phone in landscape is 844px wide and would get a picture of a phone drawn inside a phone, so the query asks the device (mouse vs finger) instead of guessing from the window. **This is the only place the layout reacts to viewport or device — don't add media queries of your own.** |
| Primary accent | `--lime` `--lime-strong` `--lime-deep` `--on-lime` (foreground **on** lime) `--lime-line` `--lime-a06` `--lime-a10` `--lime-a14` `--lime-a30` |
| Functional accents | `--gold` (XP) `--blue` (opponent/stats) `--red` (live) `--orange` (streak) `--mint` `--cyan` `--pink`; softer/deeper variants `--blue-soft` `--red-soft` `--red-deep` |
| Tiers | `--tier-bronze` `--tier-silver` `--tier-gold` `--tier-diamond` — the rank ramp (Bronze / Prata / Ouro / Diamante). No component uses these; they are yours to use when you build tier UI. |
| Text ramp | `--text-hi` `--text-1` `--text-2` `--text-muted` `--text-faint` `--text-fainter` |
| Borders | `--border-1` (hairline) `--border-2` |
| Radii | `--r-sm` `--r-md` `--r-lg` `--r-xl` `--r-2xl` `--r-3xl` `--r-4xl` `--r-pill` |
| Spacing | `--sp-1`…`--sp-12` (4→26px), `--gutter` (screen padding), `--tap-min` (44px hit target) |
| Type | `--font-sans` (body) `--font-display` (the same Archivo, meant italic + `--fw-black` for display/brand); sizes `--display-lg` `--display-md` `--display-sm` `--title` `--body-lg` `--body` `--caption` `--micro` |
| Weights | the whole scale, no others exist: `--fw-regular` 400 · `--fw-medium` **600** · `--fw-bold` 700 · `--fw-heavy` 800 · `--fw-black` 900. Note `--fw-medium` is 600, not the usual 500. |
| Tracking / leading | `--tracking-display` `--tracking-label` `--tracking-tight`; `--leading-tight` (1, display) `--leading-body` (1.5, prose) |
| Depth | `--shadow-btn` `--shadow-pop` `--shadow-logo` `--shadow-toast` `--glow-dot` `--ring-beta`; `--shadow-frame` (neutral, the app frame — the only shadow that is never lime) |
| Motion | `@keyframes` `fadeUp` (entrance) `sheetUp` (bottom sheets) `popIn` (result reveals) `pulse` (live dots) `shake` (wrong answers) `glow` (CTA ring) |

Depth comes from **layering surfaces by lightness, not shadow**. Reserve the lime glow for the one
real CTA on screen. One accent, used confidently and sparingly.

## Components

`AppFrame` (the root shell — `maxWidth`, `scroll`; see above, wrap every screen in one) · `Button`
(`variant`: primary/secondary/ghost/danger, `size`: sm/md/lg, `full`) · `Badge` (`tone`:
lime/solid/neutral/live, `dot`) · `Chip` · `Card` (`elevated`, `glow`) · `SegTabs` (`tabs`,
`value`, `onChange`) · `Toggle` (`checked`, `onChange`) · `ProgressBar` (`value` 0-100, `tone`) ·
`ListRow` (`title`, `subtitle`, `trailing`, `onClick`) · `MatchCard` (`live`, `status`, `group`,
`teamA`/`teamB`, `scoreA`/`scoreB`, `cta`).

Read `<Name>.prompt.md` and `<Name>.d.ts` next to each component before using it — they are the
contract. The full token source is `styles.css` and the files it `@import`s; read them rather than
trusting this summary.

## Content rules

Voice is **Brazilian Portuguese, casual and matey** ("a galera", "bora"), second person ("você").
Football slang over betting jargon — the app deliberately says "Acima/Abaixo", never "Hi-Lo", and
"atualizada ao vivo", never "odds". Energetic and encouraging, **never gambling-y**. Section labels
are SHORT and UPPERCASE ("MISSÃO DE HOJE"). Numbers are pt-BR formatted (`1.240`). **No emoji** —
iconography is drawn: inline SVG or CSS shapes (a dot is a `border-radius:50%` span). The brand mark
is type, not an image: `P!` italic-900 on a lime rounded square, rotated `-6deg`.

## Idiomatic example

```jsx
<AppFrame>
 <div style={{ minHeight: '100%', padding: 'var(--gutter)' }}>
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-7)' }}>
    <span style={{ fontWeight: 900, fontStyle: 'italic', fontSize: 19, letterSpacing: -0.5 }}>PALPITEI</span>
    <Chip><Badge tone="solid">Nv 7</Badge>1.240</Chip>
  </div>

  <MatchCard live status="AO VIVO · 64’" group="GRUPO J · COPA 2026"
             teamA="Argentina" teamB="Cabo Verde" scoreA={2} scoreB={1}
             cta="Entrar na sala →" onClick={open} />

  <Card elevated style={{ marginTop: 'var(--sp-5)' }}>
    <span style={{ fontWeight: 900, fontSize: 10.5, letterSpacing: 1, color: 'var(--text-faint)' }}>MISSÃO DE HOJE</span>
    <div style={{ fontWeight: 800, marginTop: 'var(--sp-4)' }}>Acerte 3 palpites seguidos</div>
    <div style={{ marginTop: 'var(--sp-5)' }}><ProgressBar value={66} /></div>
  </Card>
 </div>
</AppFrame>
```
