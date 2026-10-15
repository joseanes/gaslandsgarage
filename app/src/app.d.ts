import type { Draft } from '$lib/validate/model';

interface GarageVehicle {
	id: string;
	type: string;
	name: string;
	weapons: string[];
	weaponFacings?: Record<string, string>;
	upgrades?: string[];
	perks: string[];
}

interface GarageWindow {
	teamName?: string;
	sponsorId?: string;
	vehicles?: GarageVehicle[];
	maxCans?: number;
	darkMode?: boolean;
	rulesVersion?: 2 | 3;
	showExperimentalFeatures?: boolean;
	copyDraftFn?: () => void | Promise<void>;
	shareLinkFn?: () => void;
	generateQRCodeFn?: () => void | Promise<void>;
	importBuildFn?: () => void;
	printTeamFn?: () => void | Promise<unknown>;
	openSettingsFn?: (tab?: string) => void;
	openSettings?: (tab?: string) => void;
	copyDraft?: () => void | Promise<void>;
	shareLink?: () => void;
	generateQRCode?: () => void | Promise<void>;
	importBuild?: () => void;
	printTeam?: () => void | Promise<unknown>;
	printWithRulesCheck?: () => void | Promise<unknown>;
	openTeamsModalFn?: () => void;
	currentDraftFn?: () => Draft | null;
	importDraftFn?: (draft: unknown) => void;
}

declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	interface Window extends GarageWindow {}
}

export {};
