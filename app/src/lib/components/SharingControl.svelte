<script lang="ts">
	import { PAINTING_LINK_LABEL, PAINTING_URL_MAX, USE_PROFILE_WEBSITE_LABEL, paintingGuideLink } from '$lib/photos/link';
	import {
		CUSTOMIZE_SHARING_LABEL,
		SHARE_BUDDIES_LABEL,
		SHARE_CHOICES_COPY,
		SHARE_EVERYWHERE_LABEL,
		SHARE_FLAG_KEYS,
		SHARE_GALLERY_LABEL,
		SHARE_LINK_LABEL,
		SHARE_STATS_LABEL,
		shareChoiceState,
		shareEverywhere,
		type ShareFlagKey,
		type ShareFlags
	} from '$lib/photos/share';

	export let flags: ShareFlags;
	/** Choices the player can change. The rest stay off and their checkboxes are disabled. */
	export let activeKeys: readonly ShareFlagKey[] = SHARE_FLAG_KEYS;
	export let disabled = false;
	export let everywhereTestId = 'share-everywhere';
	export let customizeTestId = 'customize-sharing';
	export let buddiesTestId = 'share-buddies';
	export let linkTestId = 'share-link';
	export let galleryTestId = 'share-gallery';
	export let statsTestId = 'share-stats';
	export let onChange: (next: ShareFlags) => void = () => undefined;
	export let paintingUrl = '';
	export let profileWebsite = '';
	export let paintingTestId = 'painting-link';
	export let useWebsiteTestId = 'use-profile-website';
	export let onPaintingUrl: (next: string) => void = () => undefined;
	export let onPaintingCommit: (next: string) => void = () => undefined;
	export let paintingDisabled = false;

	let draft = paintingUrl;
	let seen = paintingUrl;
	let linkTouched = false;

	$: if (paintingUrl !== seen && !linkTouched) {
		seen = paintingUrl;
		draft = paintingUrl;
	}
	$: linkError = linkTouched && draft.trim() && !paintingGuideLink(draft) ? 'Use a full http or https link, up to 300 characters.' : '';

	function paintInput() {
		linkTouched = true;
		seen = draft;
		onPaintingUrl(draft);
	}

	function paintCommit() {
		linkTouched = true;
		seen = draft;
		onPaintingUrl(draft);
		onPaintingCommit(draft);
	}

	function useProfileWebsite() {
		if (!profileWebsite) return;
		draft = profileWebsite;
		paintCommit();
	}

	$: keys = activeKeys.length > 0 ? activeKeys : SHARE_FLAG_KEYS;
	$: choice = shareChoiceState(flags, keys);
	$: allOn = choice === 'on';
	$: mixed = choice === 'mixed';

	function allowed(key: ShareFlagKey): boolean {
		return keys.includes(key);
	}

	function mixedState(node: HTMLInputElement, value: boolean) {
		node.indeterminate = value;
		return {
			update(next: boolean) {
				node.indeterminate = next;
			}
		};
	}

	function restore(input: HTMLInputElement, checked: boolean, indeterminate = false) {
		input.checked = checked;
		input.indeterminate = indeterminate;
	}

	function onEverywhere(event: Event) {
		const input = event.currentTarget;
		if (!(input instanceof HTMLInputElement)) return;
		const want = input.checked;
		restore(input, allOn, mixed);
		onChange(shareEverywhere(want, keys));
	}

	function onOne(key: keyof ShareFlags, event: Event) {
		const input = event.currentTarget;
		if (!(input instanceof HTMLInputElement)) return;
		const want = input.checked;
		restore(input, flags[key]);
		onChange({ ...flags, [key]: want });
	}
</script>

<fieldset class="space-y-1" data-testid="sharing-control">
	<legend class="sr-only">Sharing for this photo</legend>
	<label class="flex items-start gap-2 text-xs font-medium text-stone-800 dark:text-gray-100">
		<input
			type="checkbox"
			class="mt-0.5"
			data-testid={everywhereTestId}
			checked={allOn}
			disabled={disabled}
			use:mixedState={mixed}
			on:change={onEverywhere}
		/>
		{SHARE_EVERYWHERE_LABEL}
	</label>
	<p class="text-xs leading-snug text-stone-600 dark:text-gray-300" data-testid="share-choices-copy">{SHARE_CHOICES_COPY}</p>
	<details>
		<summary class="cursor-pointer text-xs text-amber-800 underline dark:text-amber-200" data-testid={customizeTestId}>
			{CUSTOMIZE_SHARING_LABEL}
		</summary>
		<div class="mt-1 space-y-1">
			<label class="flex items-start gap-2 text-xs text-stone-700 dark:text-gray-200">
				<input type="checkbox" class="mt-0.5" data-testid={buddiesTestId} checked={flags.showToBuddies} disabled={disabled || !allowed('showToBuddies')} on:change={(event) => onOne('showToBuddies', event)} />
				{SHARE_BUDDIES_LABEL}
			</label>
			<label class="flex items-start gap-2 text-xs text-stone-700 dark:text-gray-200">
				<input type="checkbox" class="mt-0.5" data-testid={linkTestId} checked={flags.showOnShareLink} disabled={disabled || !allowed('showOnShareLink')} on:change={(event) => onOne('showOnShareLink', event)} />
				{SHARE_LINK_LABEL}
			</label>
			<label class="flex items-start gap-2 text-xs text-stone-700 dark:text-gray-200">
				<input type="checkbox" class="mt-0.5" data-testid={galleryTestId} checked={flags.showInGallery} disabled={disabled || !allowed('showInGallery')} on:change={(event) => onOne('showInGallery', event)} />
				{SHARE_GALLERY_LABEL}
			</label>
			<label class="flex items-start gap-2 text-xs text-stone-700 dark:text-gray-200">
				<input type="checkbox" class="mt-0.5" data-testid={statsTestId} checked={flags.shareVehicleStats} disabled={disabled || !allowed('shareVehicleStats')} on:change={(event) => onOne('shareVehicleStats', event)} />
				{SHARE_STATS_LABEL}
			</label>
		</div>
	</details>
	<label class="mt-2 block text-xs text-stone-700 dark:text-gray-200">
		{PAINTING_LINK_LABEL}
		<input
			type="url"
			class="mt-1 w-full rounded border border-stone-300 bg-white px-2 py-1 text-xs text-stone-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
			maxlength={PAINTING_URL_MAX}
			placeholder="https://"
			data-testid={paintingTestId}
			bind:value={draft}
			disabled={paintingDisabled}
			on:input={paintInput}
			on:change={paintCommit}
		/>
	</label>
	<button
		type="button"
		class="text-xs text-amber-800 underline disabled:opacity-50 dark:text-amber-200"
		data-testid={useWebsiteTestId}
		disabled={paintingDisabled || !profileWebsite}
		on:click={useProfileWebsite}
	>
		{USE_PROFILE_WEBSITE_LABEL}
	</button>
	<p class="text-[11px] leading-snug text-stone-500 dark:text-gray-400">Leave this blank and the photo has no link.</p>
	{#if linkError}
		<p class="text-[11px] text-red-800 dark:text-red-200" role="alert">{linkError}</p>
	{/if}
</fieldset>
