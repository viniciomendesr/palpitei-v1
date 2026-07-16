export interface AppFrameProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Width of the app column. Defaults to the `--app-max-w` token (420px) — override
   * per-screen only for a deliberate exception, never to build a desktop layout.
   * @default "var(--app-max-w)"
   */
  maxWidth?: number | string;
  /**
   * Render children inside the frame's own scroll region (momentum scrolling,
   * contained overscroll, safe-area padding). Set `false` only when the screen
   * manages its own scrolling — the frame still clips.
   * @default true
   */
  scroll?: boolean;
  /** Styles for the framed app column. `style` targets the backdrop behind it. */
  contentStyle?: React.CSSProperties;
  children?: React.ReactNode;
}
/**
 * The app shell — wrap every screen in exactly one of these, at the root.
 *
 * Palpitei is mobile-first and ships a single layout: the phone. On a phone the
 * frame is the screen (full width, square, no shadow, no bezel). On a desktop the
 * content is NOT stretched — the same phone layout is centred in a `--app-max-w`
 * (420px) screen, held in a light smartphone body (a 10px `--app-bezel`, concentric
 * corners) and lifted off a neutral `--app-backdrop` letterbox. There are no separate
 * desktop screens and no light theme.
 *
 * It also sets the app background, text colour and font, owns scrolling, honours
 * iOS safe areas, and clips its children so nothing escapes the frame.
 *
 * @startingPoint section="Core" subtitle="Mobile-first shell — centred 420px app on desktop" viewport="900x560"
 */
export function AppFrame(props: AppFrameProps): JSX.Element;
