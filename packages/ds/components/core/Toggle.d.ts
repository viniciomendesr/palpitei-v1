export interface ToggleProps { checked?: boolean; onChange?: (next: boolean) => void; }
/** Lime on/off switch used in settings. */
export function Toggle(props: ToggleProps): JSX.Element;