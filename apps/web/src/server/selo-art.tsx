/**
 * The Selo TxLINE artwork, drawn by Satori instead of by a person.
 *
 * NOTHING HERE IS HAND-DRAWN AND NOTHING IS HARDCODED. Every colour, radius,
 * type size, weight and spacing is a design token read from `packages/ds` by
 * `ds-tokens.ts`; the layout is the app's own 420px scale multiplied by
 * `SELO_SCALE`. There is no emoji: the one piece of iconography is inline SVG.
 *
 * SATORI'S SUBSET, AND WHAT IT COST. `next/og` renders through Satori, which is
 * not a browser. Three limits shaped this file, and each is worked around rather
 * than papered over with a literal:
 *
 *   1. NO CUSTOM PROPERTIES. `var(--lime)` is not resolved and not reported; the
 *      element simply renders wrong. Hence `dsToken()`, which reads the design
 *      system's token files and hands back the literal. The art still names only
 *      tokens.
 *   2. NO `text-transform`. Every upper-case string here is upper-cased in
 *      JavaScript. Do not "fix" it with CSS: it does nothing.
 *   3. ONE FONT WEIGHT. Satori cannot read WOFF2, which is the only format the
 *      design system ships Archivo in (`packages/ds/fonts/*.woff2`), and
 *      converting it would mean a new dependency the brief forbids. The bundled
 *      fallback is Noto Sans at weight 400 only, and Satori does not synthesise
 *      bold: `--fw-black` would render identically to `--fw-regular`. So the
 *      hierarchy here is built from SIZE, COLOUR, CASE and TRACKING, which
 *      survive the substitution, and the brand mark gets its weight from a
 *      filled lime block rather than from a 900 weight that would not arrive.
 *      This is a real departure from the app's typography and is stated here
 *      rather than hidden.
 *
 * The seal marks a debut. It carries no fan, no palpite and no result, so there
 * is nothing on it that could imply the palpite came off.
 */

import { ImageResponse } from 'next/og';

import { dsPx, dsToken } from './ds-tokens.ts';
import { SELO_IMAGE_SIZE, SELO_SCALE, teamNameFontSize, type SeloMatchView } from './selo-badge.ts';

/**
 * Immutable once minted: a slug names one match, and a match's teams and
 * kickoff never change. A year with `immutable` lets wallets and marketplaces
 * cache the seal forever, which is what an on-chain `image` URL wants.
 */
export const SELO_IMAGE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * A miss is NOT cached. A slug can be unknown today and real tomorrow, once the
 * match is ingested; a year-long negative cache would pin a 404 onto a URL that
 * an asset already points at, permanently.
 */
export const SELO_MISS_CACHE_CONTROL = 'no-store';

const px = (token: string) => dsPx(token, SELO_SCALE);

/** The footer carries two labels on one line; full `--micro` overran the card. */
const FOOTER_SCALE = 0.7;

/** The brand mark: `P!` on a lime rounded square, rotated. Type, never an image. */
function BrandMark() {
  const side = px('--sp-12') * 1.7;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: side,
        height: side,
        background: dsToken('--lime'),
        color: dsToken('--on-lime'),
        borderRadius: px('--r-lg'),
        transform: 'rotate(-6deg)',
        fontSize: side * 0.52,
        fontStyle: 'italic',
        letterSpacing: dsPx('--tracking-display', SELO_SCALE),
      }}
    >
      P!
    </div>
  );
}

/**
 * The anchor glyph: a shield outline over a chain link.
 *
 * Inline SVG because the content rules forbid emoji and this is the only
 * iconography on the seal. It stands for the anchoring the badge claims, next to
 * the words that make the claim.
 */
function AnchorGlyph({ size }: { size: number }) {
  const stroke = dsToken('--lime');
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2.5 20 5.5v6.2c0 4.6-3.2 8.4-8 9.8-4.8-1.4-8-5.2-8-9.8V5.5L12 2.5Z"
        stroke={stroke}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M12 8.6v6.4M9.4 11.2h5.2" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * SHORT and UPPERCASE, the way section labels read everywhere else in the app.
 *
 * `scale` exists for the footer, whose two labels sit on one line and overran
 * the card at full `--micro`. Satori does not wrap or ellipsize a flex row: the
 * right-hand label simply drew past the edge of the artwork. Caught by looking
 * at the render, not by the build.
 */
function Label({ text, color, scale = 1 }: { text: string; color: string; scale?: number }) {
  return (
    <div
      style={{
        color,
        fontSize: px('--micro') * scale,
        letterSpacing: dsPx('--tracking-label', SELO_SCALE) * scale,
      }}
    >
      {text.toUpperCase()}
    </div>
  );
}

/**
 * The one bright block on the seal, and the element that carries it at
 * thumbnail size: at 64px the words are gone but the lime bar still reads as a
 * stamp against the near-black card.
 */
function MilestonePill({ text }: { text: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: dsToken('--lime'),
        color: dsToken('--on-lime'),
        borderRadius: px('--r-pill'),
        paddingTop: px('--sp-5'),
        paddingBottom: px('--sp-5'),
        paddingLeft: px('--sp-11'),
        paddingRight: px('--sp-11'),
        fontSize: px('--body-lg'),
        letterSpacing: dsPx('--tracking-label', SELO_SCALE),
      }}
    >
      {text.toUpperCase()}
    </div>
  );
}

/** The shell every seal shares: dark page, inset card, header and footer. */
function SeloFrame({ footer, children }: { footer: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        background: dsToken('--bg-page'),
        padding: px('--gutter'),
        fontFamily: 'sans-serif',
        color: dsToken('--text-hi'),
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          background: dsToken('--surface-1'),
          border: `${Math.max(2, px('--sp-1') * 0.4)}px solid ${dsToken('--lime-line')}`,
          borderRadius: px('--r-4xl'),
          padding: px('--sp-9'),
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <BrandMark />
          <div
            style={{
              display: 'flex',
              marginLeft: px('--sp-7'),
              fontSize: px('--display-sm'),
              fontStyle: 'italic',
              letterSpacing: dsPx('--tracking-display', SELO_SCALE),
            }}
          >
            PALPITEI
          </div>
          <div style={{ display: 'flex', flex: 1 }} />
          <Label text="Selo TxLINE" color={dsToken('--text-muted')} />
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {children}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            borderTop: `${Math.max(1, px('--sp-1') * 0.2)}px solid ${dsToken('--border-2')}`,
            paddingTop: px('--sp-7'),
          }}
        >
          <AnchorGlyph size={px('--body-lg') * 0.8} />
          <div style={{ display: 'flex', marginLeft: px('--sp-3') }}>
            <Label text={footer} color={dsToken('--text-muted')} scale={FOOTER_SCALE} />
          </div>
          <div style={{ display: 'flex', flex: 1 }} />
          <Label text="Intransferível" color={dsToken('--text-fainter')} scale={FOOTER_SCALE} />
        </div>
      </div>
    </div>
  );
}

const IMAGE_OPTIONS = {
  width: SELO_IMAGE_SIZE,
  height: SELO_IMAGE_SIZE,
  headers: { 'Cache-Control': SELO_IMAGE_CACHE_CONTROL },
} as const;

/**
 * The match seal. Identical for every fan who debuted on this match.
 *
 * It states the two things a stamp has to state at a glance: WHICH match, and
 * that this marks a first live palpite. It never states how the palpite went.
 */
export function renderSeloMatchImage(view: SeloMatchView): ImageResponse {
  const teamSize = teamNameFontSize(view, px('--display-lg'));
  return new ImageResponse(
    (
      <SeloFrame footer="Dados ancorados pela TxLINE · TxODDS">
        <Label text="Estreia" color={dsToken('--text-faint')} />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            marginTop: px('--sp-6'),
          }}
        >
          <div style={{ display: 'flex', fontSize: teamSize, letterSpacing: dsPx('--tracking-tight', SELO_SCALE) }}>
            {view.home}
          </div>
          <div
            style={{
              display: 'flex',
              color: dsToken('--lime'),
              fontSize: teamSize * 0.4,
              marginTop: px('--sp-2'),
              marginBottom: px('--sp-2'),
              letterSpacing: dsPx('--tracking-label', SELO_SCALE),
            }}
          >
            X
          </div>
          <div style={{ display: 'flex', fontSize: teamSize, letterSpacing: dsPx('--tracking-tight', SELO_SCALE) }}>
            {view.away}
          </div>
        </div>
        <div style={{ display: 'flex', marginTop: px('--sp-5'), marginBottom: px('--sp-6') }}>
          <Label text={view.dateLabel} color={dsToken('--text-2')} />
        </div>
        <MilestonePill text="Primeiro palpite ao vivo" />
      </SeloFrame>
    ),
    IMAGE_OPTIONS,
  );
}

/** The collection seal. Names the collection, not any one match and not any fan. */
export function renderSeloCollectionImage(): ImageResponse {
  return new ImageResponse(
    (
      <SeloFrame footer="Dados ancorados pela TxLINE · TxODDS">
        <Label text="Coleção" color={dsToken('--text-faint')} />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            marginTop: px('--sp-8'),
          }}
        >
          <div
            style={{
              display: 'flex',
              fontSize: px('--display-lg'),
              letterSpacing: dsPx('--tracking-tight', SELO_SCALE),
            }}
          >
            SELO
          </div>
          <div
            style={{
              display: 'flex',
              color: dsToken('--lime'),
              fontSize: px('--display-lg'),
              letterSpacing: dsPx('--tracking-tight', SELO_SCALE),
            }}
          >
            TxLINE
          </div>
        </div>
        <div style={{ display: 'flex', marginTop: px('--sp-5'), marginBottom: px('--sp-6') }}>
          <Label text="Palpitei · Copa 2026" color={dsToken('--text-2')} />
        </div>
        <MilestonePill text="Recibos de estreia ao vivo" />
      </SeloFrame>
    ),
    IMAGE_OPTIONS,
  );
}
