export interface MatchCardProps {
  status: string; group: string;
  teamA: string; teamB: string; scoreA?: React.ReactNode; scoreB?: React.ReactNode;
  cta?: string; onClick?: () => void; live?: boolean;
}
/**
 * Match fixture card: live/finished/upcoming state, teams, score and optional CTA.
 * @startingPoint section="Core" subtitle="Live match fixture card" viewport="700x150"
 */
export function MatchCard(props: MatchCardProps): JSX.Element;