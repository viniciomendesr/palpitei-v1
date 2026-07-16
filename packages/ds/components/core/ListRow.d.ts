export interface ListRowProps { title: React.ReactNode; subtitle?: React.ReactNode; trailing?: React.ReactNode; onClick?: () => void; }
/** Settings / menu row with title, subtitle and trailing chevron. */
export function ListRow(props: ListRowProps): JSX.Element;