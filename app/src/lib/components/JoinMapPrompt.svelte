<script lang="ts">
	import { browser } from '$app/environment';
	import { createEventDispatcher, tick } from 'svelte';
	import LocationField from '$lib/components/LocationField.svelte';
	import {
		dismissJoinBanner,
		formForJoin,
		isJoinDismissed,
		joinDraft,
		shouldShowJoinBanner,
		type JoinDraft
	} from '$lib/players/joinBanner';
	import { ANONYMOUS_ON_MAP_LABEL, LOCATION_HELP, MAP_PIN_EXPLANATION, SHOW_ON_MAP_LABEL } from '$lib/players/mapCopy';
	import type { StoredProfile } from '$lib/players/profile';
	import { saveOwnProfile } from '$lib/services/playerProfile';

	export let uid = '';
	export let profile: StoredProfile | null = null;

	const dispatch = createEventDispatcher<{ joined: StoredProfile }>();
	const fieldClass =
		'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';

	let dismissed = false;
	let trackedUid = '';
	let open = false;
	let confirmed = false;
	let editingLocation = false;
	let busy = false;
	let notice = '';
	let noticeError = false;
	let draft: JoinDraft = joinDraft(null);
	let panel: HTMLDivElement | undefined;
	let openButton: HTMLButtonElement | undefined;
	let confirmedEl: HTMLParagraphElement | undefined;

	$: if (uid !== trackedUid) {
		trackedUid = uid;
		dismissed = uid ? isJoinDismissed(browser ? localStorage : null, uid) : false;
		open = false;
		confirmed = false;
		notice = '';
	}

	$: showBanner = shouldShowJoinBanner({
		signedIn: Boolean(uid),
		showOnMap: profile?.showOnMap === true,
		dismissed
	});

	function tabbables(root: HTMLElement): HTMLElement[] {
		const nodes = root.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea');
		return [...nodes].filter((el) => {
			if (el.tabIndex < 0) return false;
			if ('disabled' in el && (el as HTMLInputElement).disabled) return false;
			if (el.getAttribute('aria-hidden') === 'true') return false;
			if (el.hasAttribute('hidden')) return false;
			return el.getClientRects().length > 0;
		});
	}

	function onPanelKey(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			const target = event.target;
			// The city widget uses Escape to close its own suggestion list.
			if (target instanceof Element && target.closest('.places-host')) return;
			event.preventDefault();
			closePanel();
			return;
		}
		if (event.key !== 'Tab' || !panel) return;
		const items = tabbables(panel);
		if (items.length === 0) {
			event.preventDefault();
			return;
		}
		const first = items[0];
		const last = items[items.length - 1];
		const active = document.activeElement;
		if (event.shiftKey) {
			if (active === first || active === panel || !panel.contains(active)) {
				event.preventDefault();
				last.focus();
			}
			return;
		}
		if (active === last) {
			event.preventDefault();
			first.focus();
		}
	}

	async function openPanel() {
		draft = joinDraft(profile);
		editingLocation = !draft.hasLocation;
		notice = '';
		noticeError = false;
		open = true;
		await tick();
		panel?.focus();
	}

	async function closePanel() {
		open = false;
		notice = '';
		await tick();
		openButton?.focus();
	}

	function dismiss() {
		dismissJoinBanner(browser ? localStorage : null, uid);
		dismissed = true;
		open = false;
	}

	function onMapToggle() {
		if (!draft.showOnMap) draft.anonymousOnMap = false;
	}

	async function save() {
		if (!draft.showOnMap) {
			notice = 'Turn on "Show me on the players map" before joining.';
			noticeError = true;
			return;
		}
		busy = true;
		notice = '';
		noticeError = false;
		const result = await saveOwnProfile(uid, formForJoin(profile, draft), profile);
		busy = false;
		if (!result.success) {
			notice = result.error;
			noticeError = true;
			return;
		}
		open = false;
		confirmed = true;
		dispatch('joined', result.profile);
		await tick();
		confirmedEl?.focus();
	}
</script>

{#if confirmed}
	<p
		bind:this={confirmedEl}
		class="mb-4 rounded-lg border border-amber-600 bg-amber-50 p-4 text-stone-800 outline-none dark:border-amber-500 dark:bg-gray-800 dark:text-gray-100"
		role="status"
		tabindex="-1"
		data-testid="join-map-confirmed"
	>
		You're on the players map.
		<a href="/profile" class="text-amber-700 underline dark:text-amber-300">Change or remove it on your profile.</a>
	</p>
{:else if showBanner}
	<div
		class="mb-4 rounded-lg border border-amber-600 bg-amber-50 p-4 text-stone-800 dark:border-amber-500 dark:bg-gray-800 dark:text-gray-100"
		data-testid="join-map-banner"
	>
		<p class="font-medium">Want to appear on the players map?</p>
		<div class="mt-3 flex flex-wrap gap-2">
			<button type="button" class="amber-button rounded-lg px-4" bind:this={openButton} data-testid="join-map-open" on:click={openPanel}>
				Join the map
			</button>
			<button
				type="button"
				class="rounded-lg border border-stone-300 bg-white px-4 text-stone-800 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
				data-testid="join-map-dismiss"
				on:click={dismiss}
			>
				Not now
			</button>
		</div>
	</div>

	{#if open}
		<div
			bind:this={panel}
			class="mb-4 rounded-lg border border-stone-300 bg-white p-4 text-stone-800 outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
			role="dialog"
			aria-modal="false"
			aria-labelledby="join-map-title"
			aria-describedby="join-map-explain"
			tabindex="-1"
			data-testid="join-map-panel"
			on:keydown={onPanelKey}
		>
			<h2 id="join-map-title" class="text-lg font-bold">Join the players map</h2>
			<p id="join-map-explain" class="mt-2 text-sm text-stone-600 dark:text-gray-300">{MAP_PIN_EXPLANATION}</p>

			<form class="mt-4 space-y-4" on:submit|preventDefault={save}>
				<div>
					<label for="join-player-name" class="mb-1 block text-sm font-medium">Player name</label>
					<input
						id="join-player-name"
						class={fieldClass}
						maxlength="60"
						bind:value={draft.playerName}
						data-testid="join-player-name"
						autocomplete="nickname"
					/>
				</div>

				<div>
					{#if draft.hasLocation && !editingLocation}
						<p class="text-sm font-medium">General location</p>
						<p class="mt-1" data-testid="join-map-location-label">{draft.locationLabel}</p>
						<button
							type="button"
							class="mt-2 text-amber-700 underline dark:text-amber-300"
							data-testid="join-map-change-location"
							on:click={() => (editingLocation = true)}
						>
							Change location
						</button>
					{:else}
						<LocationField bind:value={draft.locationLabel} inputClass={fieldClass} />
						<p class="mt-1 text-sm text-stone-600 dark:text-gray-300">{LOCATION_HELP}</p>
					{/if}
				</div>

				<fieldset class="rounded-lg border border-stone-200 p-4 dark:border-gray-700">
					<legend class="px-1 font-medium">Players map</legend>
					<label class="mt-2 flex items-start gap-2">
						<input type="checkbox" bind:checked={draft.showOnMap} on:change={onMapToggle} data-testid="join-map-consent" />
						<span>{SHOW_ON_MAP_LABEL}</span>
					</label>
					<label class="mt-3 flex items-start gap-2">
						<input
							type="checkbox"
							bind:checked={draft.anonymousOnMap}
							disabled={!draft.showOnMap}
							data-testid="join-map-anonymous"
						/>
						<span>{ANONYMOUS_ON_MAP_LABEL}</span>
					</label>
				</fieldset>

				<div class="flex flex-wrap items-center gap-3">
					<button type="submit" class="amber-button rounded-lg px-4" disabled={busy} data-testid="join-map-save">
						{busy ? 'Saving…' : 'Save and join'}
					</button>
					<button type="button" class="text-stone-600 underline dark:text-gray-300" on:click={closePanel}>Cancel</button>
				</div>
				{#if notice}
					<p
						role={noticeError ? 'alert' : 'status'}
						class={noticeError ? 'text-red-700 dark:text-red-300' : 'text-stone-700 dark:text-gray-200'}
						data-testid="join-map-notice"
					>
						{notice}
					</p>
				{/if}
			</form>
		</div>
	{/if}
{/if}
