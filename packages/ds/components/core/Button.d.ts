export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual weight. @default 'primary' */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** @default 'md' */
  size?: 'sm' | 'md' | 'lg';
  /** Stretch to container width. @default false */
  full?: boolean;
  children?: React.ReactNode;
}
/**
 * Primary action button. Lime fill for the main action, outline for secondary, ghost for tertiary, danger for destructive.
 * @startingPoint section="Core" subtitle="Lime CTA + secondary/ghost/danger" viewport="700x150"
 */
export function Button(props: ButtonProps): JSX.Element;