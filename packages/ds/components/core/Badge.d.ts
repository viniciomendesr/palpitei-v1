export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** @default 'lime' */
  tone?: 'lime' | 'solid' | 'neutral' | 'live';
  /** Leading glowing dot (e.g. BETA / LIVE). @default false */
  dot?: boolean;
  children?: React.ReactNode;
}
/** Small status badge: BETA, LIVE, level, streak. */
export function Badge(props: BadgeProps): JSX.Element;