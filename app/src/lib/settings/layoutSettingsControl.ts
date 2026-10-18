export type SettingsTab = 'general' | 'print';

type OpenSettings = (tab: SettingsTab) => void;

let openSettings: OpenSettings | null = null;

/** The layout host registers while a non-builder page is showing. */
export function registerLayoutSettings(open: OpenSettings): () => void {
	openSettings = open;
	return () => {
		if (openSettings === open) openSettings = null;
	};
}

export function openLayoutSettings(tab: SettingsTab): void {
	openSettings?.(tab);
}
