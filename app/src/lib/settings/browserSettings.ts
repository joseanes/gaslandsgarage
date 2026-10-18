import type { UserSettings } from '$lib/services/settings';

const DEFAULTS = {
	enableSponsorships: true,
	includeAdvanced: true,
	darkMode: false,
	printStyle: 'classic',
	showTeamSummary: true,
	showGaslandsMath: true,
	hasRules: false,
	showExperimentalFeatures: false,
	showOnPlayersMap: false,
	allowContactFromPlayers: false,
	location: '',
	showEquipmentDescriptions: true,
	showPerkDescriptions: true,
	showSpecialRules: true
};

export type LayoutSettingsState = {
	hasRules: boolean;
	enableSponsorships: boolean;
	includeAdvanced: boolean;
	darkMode: boolean;
	showTeamSummary: boolean;
	showGaslandsMath: boolean;
	printStyle: string;
	showEquipmentDescriptions: boolean;
	showPerkDescriptions: boolean;
	showSpecialRules: boolean;
	showExperimentalFeatures: boolean;
	showOnPlayersMap: boolean;
	allowContactFromPlayers: boolean;
	location: string;
};

type StorageLike = { getItem: (key: string) => string | null };

function flag(storage: StorageLike | null, key: string, fallback: boolean): boolean {
	const value = storage?.getItem(key);
	if (value === null || value === undefined || value === '') return fallback;
	return value === 'true' || value === '1';
}

function text(storage: StorageLike | null, key: string, fallback: string): string {
	const value = storage?.getItem(key);
	return value ? value : fallback;
}

/** Values the settings screen last wrote to this browser. Missing keys stay at the defaults. */
export function readLayoutSettings(storage: StorageLike | null): LayoutSettingsState {
	const printStyle = text(storage, 'printStyle', '') || text(storage, 'user_print_style', DEFAULTS.printStyle);
	const equipment = storage?.getItem('showEquipmentDescriptions') || storage?.getItem('user_show_equipment');
	const perks = storage?.getItem('showPerkDescriptions') || storage?.getItem('user_show_perks');
	const special = storage?.getItem('showSpecialRules') || storage?.getItem('user_show_special_rules');
	return {
		hasRules: flag(storage, 'hasRules', DEFAULTS.hasRules),
		enableSponsorships: flag(storage, 'enableSponsorships', DEFAULTS.enableSponsorships),
		includeAdvanced: flag(storage, 'includeAdvanced', DEFAULTS.includeAdvanced),
		darkMode: flag(storage, 'darkMode', DEFAULTS.darkMode),
		showTeamSummary: flag(storage, 'showTeamSummary', DEFAULTS.showTeamSummary),
		showGaslandsMath: flag(storage, 'showGaslandsMath', DEFAULTS.showGaslandsMath),
		printStyle,
		showEquipmentDescriptions: equipment ? equipment === 'true' || equipment === '1' : DEFAULTS.showEquipmentDescriptions,
		showPerkDescriptions: perks ? perks === 'true' || perks === '1' : DEFAULTS.showPerkDescriptions,
		showSpecialRules: special ? special === 'true' || special === '1' : DEFAULTS.showSpecialRules,
		showExperimentalFeatures: flag(storage, 'showExperimentalFeatures', DEFAULTS.showExperimentalFeatures),
		showOnPlayersMap: flag(storage, 'showOnPlayersMap', DEFAULTS.showOnPlayersMap),
		allowContactFromPlayers: flag(storage, 'allowContactFromPlayers', DEFAULTS.allowContactFromPlayers),
		location: storage?.getItem('location') ?? DEFAULTS.location
	};
}

/** Account settings win when the field was saved. A missing field keeps the browser value. */
export function settingsFromAccount(current: LayoutSettingsState, remote: Partial<UserSettings>): LayoutSettingsState {
	return {
		hasRules: remote.hasRules ?? current.hasRules,
		enableSponsorships: remote.enableSponsorships ?? current.enableSponsorships,
		includeAdvanced: remote.includeAdvanced ?? current.includeAdvanced,
		darkMode: remote.darkMode ?? current.darkMode,
		showTeamSummary: remote.showTeamSummary ?? current.showTeamSummary,
		showGaslandsMath: remote.showGaslandsMath ?? current.showGaslandsMath,
		printStyle: remote.printStyle || current.printStyle,
		showEquipmentDescriptions: remote.showEquipmentDescriptions ?? current.showEquipmentDescriptions,
		showPerkDescriptions: remote.showPerkDescriptions ?? current.showPerkDescriptions,
		showSpecialRules: remote.showSpecialRules ?? current.showSpecialRules,
		showExperimentalFeatures: remote.showExperimentalFeatures ?? current.showExperimentalFeatures,
		showOnPlayersMap: remote.showOnPlayersMap ?? current.showOnPlayersMap,
		allowContactFromPlayers: remote.allowContactFromPlayers ?? current.allowContactFromPlayers,
		location: remote.location ?? current.location
	};
}
