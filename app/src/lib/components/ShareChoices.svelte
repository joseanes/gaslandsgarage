<script lang="ts">
	import {
		CUSTOMIZE_SHARING_LABEL,
		SHARE_BUDDIES_LABEL,
		SHARE_CHOICES_COPY,
		SHARE_EVERYWHERE_LABEL,
		SHARE_GALLERY_LABEL,
		SHARE_LINK_LABEL,
		SHARE_STATS_LABEL,
		SHARE_FLAG_KEYS,
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

<fieldset class="space-y-1" {disabled}>
	<legend class="sr-only">Sharing for this photo</legend>
	<label class="flex items-start gap-2 text-xs font-medium text-stone-800 dark:text-gray-100">
		<input
			type="checkbox"
			class="mt-0.5"
			data-testid={everywhereTestId}
			checked={allOn}
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
				<input type="checkbox" class="mt-0.5" data-testid={buddiesTestId} checked={flags.showToBuddies} disabled={!allowed('showToBuddies')} on:change={(event) => onOne('showToBuddies', event)} />
				{SHARE_BUDDIES_LABEL}
			</label>
			<label class="flex items-start gap-2 text-xs text-stone-700 dark:text-gray-200">
				<input type="checkbox" class="mt-0.5" data-testid={linkTestId} checked={flags.showOnShareLink} disabled={!allowed('showOnShareLink')} on:change={(event) => onOne('showOnShareLink', event)} />
				{SHARE_LINK_LABEL}
			</label>
			<label class="flex items-start gap-2 text-xs text-stone-700 dark:text-gray-200">
				<input type="checkbox" class="mt-0.5" data-testid={galleryTestId} checked={flags.showInGallery} disabled={!allowed('showInGallery')} on:change={(event) => onOne('showInGallery', event)} />
				{SHARE_GALLERY_LABEL}
			</label>
			<label class="flex items-start gap-2 text-xs text-stone-700 dark:text-gray-200">
				<input type="checkbox" class="mt-0.5" data-testid={statsTestId} checked={flags.shareVehicleStats} disabled={!allowed('shareVehicleStats')} on:change={(event) => onOne('shareVehicleStats', event)} />
				{SHARE_STATS_LABEL}
			</label>
		</div>
	</details>
</fieldset>
