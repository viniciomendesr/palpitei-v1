export interface SegTab { label: string; value: string; }
export interface SegTabsProps { tabs: SegTab[]; value: string; onChange?: (v: string) => void; }
/** Pill-style segmented tab row (Ao Vivo / Próximos / Replays). */
export function SegTabs(props: SegTabsProps): JSX.Element;