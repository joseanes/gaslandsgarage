<script lang="ts">
	import { onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import SettingsMenu from '$lib/components/SettingsMenu.svelte';
	import { saveUserSettings, accountSettings, type UserSettings } from '$lib/services/settings';
	import { readLayoutSettings, settingsFromAccount, type LayoutSettingsState } from '$lib/settings/browserSettings';
	import { registerLayoutSettings, type SettingsTab } from '$lib/settings/layoutSettingsControl';

	const initial = readLayoutSettings(browser ? localStorage : null);
	let hasRules = initial.hasRules;
	let enableSponsorships = initial.enableSponsorships;
	let includeAdvanced = initial.includeAdvanced;
	let darkMode = initial.darkMode;
	let showTeamSummary = initial.showTeamSummary;
	let showGaslandsMath = initial.showGaslandsMath;
	let printStyle = initial.printStyle;
	let showEquipmentDescriptions = initial.showEquipmentDescriptions;
	let showPerkDescriptions = initial.showPerkDescriptions;
	let showSpecialRules = initial.showSpecialRules;
	let showExperimentalFeatures = initial.showExperimentalFeatures;
	let showOnPlayersMap = initial.showOnPlayersMap;
	let allowContactFromPlayers = initial.allowContactFromPlayers;
	let location = initial.location;
	let receiveUpdates = initial.receiveUpdates;
	let showSettingsModal = false;
	let activeSettingsTab: SettingsTab = 'general';
	let appliedAccount: UserSettings | null = null;

	function currentState(): LayoutSettingsState {
		return {
			hasRules,
			enableSponsorships,
			includeAdvanced,
			darkMode,
			showTeamSummary,
			showGaslandsMath,
			printStyle,
			showEquipmentDescriptions,
			showPerkDescriptions,
			showSpecialRules,
			showExperimentalFeatures,
			showOnPlayersMap,
			allowContactFromPlayers,
			location,
			receiveUpdates
		};
	}

	function applyState(next: LayoutSettingsState) {
		hasRules = next.hasRules;
		enableSponsorships = next.enableSponsorships;
		includeAdvanced = next.includeAdvanced;
		darkMode = next.darkMode;
		showTeamSummary = next.showTeamSummary;
		showGaslandsMath = next.showGaslandsMath;
		printStyle = next.printStyle;
		showEquipmentDescriptions = next.showEquipmentDescriptions;
		showPerkDescriptions = next.showPerkDescriptions;
		showSpecialRules = next.showSpecialRules;
		showExperimentalFeatures = next.showExperimentalFeatures;
		showOnPlayersMap = next.showOnPlayersMap;
		allowContactFromPlayers = next.allowContactFromPlayers;
		location = next.location;
		receiveUpdates = next.receiveUpdates;
	}

	// Apply the saved account once. Skip while the dialog is open so Cancel keeps
	// the same on-screen edits the builder settings screen already keeps.
	$: if ($accountSettings && $accountSettings !== appliedAccount) {
		appliedAccount = $accountSettings;
		if (!showSettingsModal) applyState(settingsFromAccount(currentState(), $accountSettings));
	}

	$: if (browser) {
		document.documentElement.classList.toggle('dark-mode', darkMode);
		document.documentElement.classList.toggle('dark', darkMode);
		localStorage.setItem('darkMode', String(darkMode));
	}

	async function saveSettings(settings: Record<string, unknown>) {
		await saveUserSettings(settings as unknown as UserSettings);
	}

	const unregister = browser
		? registerLayoutSettings((tab) => {
				activeSettingsTab = tab;
				showSettingsModal = true;
			})
		: () => {};

	onDestroy(unregister);
</script>

{#if showSettingsModal}
	<SettingsMenu
		bind:showSettingsModal
		bind:activeSettingsTab
		bind:hasRules
		bind:enableSponsorships
		bind:includeAdvanced
		bind:darkMode
		bind:showTeamSummary
		bind:showGaslandsMath
		bind:printStyle
		bind:showEquipmentDescriptions
		bind:showPerkDescriptions
		bind:showSpecialRules
		bind:showExperimentalFeatures
		bind:showOnPlayersMap
		bind:allowContactFromPlayers
		bind:location
		bind:receiveUpdates
		saveSettingsToFirebase={saveSettings}
	/>
{/if}
