# Palpitei Design System

Design system for **Palpitei** — a live-football prediction game (Copa do Mundo 2026). Players make in-match predictions ("palpites"), earn XP, climb rankings, and compete in private leagues with friends. No real money — the currency is XP and bragging rights. Premium unlocks unlimited private leagues.

**Source of truth:** root `Palpitei v1.dc.html` (the clickable prototype). All tokens and components were extracted from that file.

## Manifest
- `styles.css` — entry point (imports all tokens + fonts).
- `tokens/` — `colors.css`, `typography.css`, `spacing.css`, `effects.css`.
- `guidelines/` — foundation specimen cards (Colors, Type, Spacing, Effects, Brand).
- `components/core/` — Button, Badge, Chip, SegTabs, Card, Toggle, ProgressBar, ListRow, MatchCard.
- `ui_kits/webapp/` — click-through recreation (login → home → match).
- `SKILL.md` — portable skill entry.

## Content fundamentals
Voice is **Brazilian-Portuguese, casual and matey** ("a galera", "bora", "olho clínico"). Second person ("você"). Football slang over jargon — the app deliberately renamed technical betting terms ("Acima/Abaixo" instead of Hi-Lo, "atualizada ao vivo" instead of odds feeds). Section labels are SHORT and UPPERCASE ("MISSÃO DE HOJE", "CONQUISTAS"). Numbers use pt-BR formatting (1.240). No emoji — iconography is drawn (CSS shapes / small SVGs). Tone: energetic, encouraging, never gambling-y. EN locale is supported (full string map lives in the prototype).

## Visual foundations
- **Color:** near-black greens (`#0A0C0B` → `#182019`) with a single electric-lime accent `#C8F13F`. Foreground on lime is the dark `#0B0E0D`. Functional accents: gold (XP), blue (opponent/stats), red (live), orange (streak). One dominant accent, used sparingly and confidently.
- **Type:** Archivo throughout. Display = **italic 900**, tight tracking (-1.5px) — jersey/sport energy. Body 400–800. Labels 900 uppercase, +1px tracking.
- **Shape:** generous radii (cards 18px, buttons 16px, pills 99px). Hairline borders `rgba(255,255,255,.07)`; lime-tinted borders on active/elevated surfaces.
- **Depth:** flat dark surfaces layered by lightness, not shadow. Lime CTAs get a soft drop glow (`0 12px 30px rgba(200,241,63,.25)`). Live/CTA cards use an animated pulsing ring (`glow`).
- **Motion:** `fadeUp` on entrance, `sheetUp` for bottom sheets, `popIn` for result reveals, `pulse` for live dots, `shake` on wrong answers, confetti `fall`. Press state = `transform:scale(.98)`. Hover on cards = brighten border.

## Iconography
No icon font. Small **inline SVGs** (soccer ball = Tabler ball-football), CSS-shape glyphs (rotated squares for medals/tiers, circles for dots), and brand text mark **P!** (lime rounded square, italic). Official auth logos (Google 4-color, Solana gradient, Privy wordmark) are inline SVG in the prototype. **No standalone logo file exists** — the wordmark is rendered in type.

## Intentional additions
- `MatchCard`, `SegTabs`, `Chip` — not "standard" primitives but are the app's most-repeated composite units, so promoted to components.

## Caveats
- Component/UI-kit cards resolve the bundle namespace dynamically (`window.*` scan) because the project title was left as the prototype name; if you rename the project, the cards still work.
- Fonts load from Google Fonts (Archivo) — no local font binaries were provided.
