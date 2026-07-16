export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Elevated surface + lime tint border. @default false */
  elevated?: boolean;
  /** Pulsing lime glow (calls to action). @default false */
  glow?: boolean;
  children?: React.ReactNode;
}
/** Base surface container with the standard 18px radius and hairline border. */
export function Card(props: CardProps): JSX.Element;