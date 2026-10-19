<script lang="ts">
	import { onMount } from 'svelte';
	import { carShareUrl, shareIntent, type ShareChannel } from '$lib/photos/carPage';

	export let shareId: string;
	export let carName: string;
	export let compact = false;

	let notice = '';
	let canNativeShare = false;

	function pageUrl(channel?: ShareChannel): string {
		return carShareUrl(shareId, channel);
	}

	$: xUrl = shareIntent('x', pageUrl('x'), carName);
	$: facebookUrl = shareIntent('facebook', pageUrl('facebook'), carName);
	$: redditUrl = shareIntent('reddit', pageUrl('reddit'), carName);

	onMount(() => {
		const narrow = window.matchMedia('(max-width: 640px)').matches;
		canNativeShare = narrow && typeof navigator.share === 'function';
	});

	async function copyLink() {
		const url = pageUrl('copy');
		try {
			await navigator.clipboard.writeText(url);
			notice = 'Link copied';
		} catch {
			notice = 'Select the link and copy it.';
		}
	}

	async function nativeShare() {
		try {
			await navigator.share({ title: carName, url: pageUrl('native') });
		} catch (error) {
			const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
			if (name === 'AbortError') return;
			notice = 'This device could not open the share sheet.';
		}
	}
</script>

<div class="share-car {compact ? 'text-xs' : 'text-sm'}" data-testid="share-car">
	{#if !compact}
		<label class="mb-1 block text-xs font-medium text-stone-600 dark:text-gray-300" for="car-share-link">Car page link</label>
		<input id="car-share-link" class="mb-2 w-full rounded-md border border-stone-300 bg-white px-2 text-stone-800 dark:border-gray-600 dark:bg-gray-800" readonly value={pageUrl('copy')} data-testid="share-link" />
	{/if}
	<div class="flex flex-wrap gap-1">
		<button type="button" class="rounded-md border border-stone-300 px-2 dark:border-gray-600" data-testid="share-copy" on:click={copyLink}>Copy link</button>
		<a class="inline-flex items-center rounded-md border border-stone-300 px-2 dark:border-gray-600" href={xUrl} target="_blank" rel="noopener noreferrer" data-testid="share-x">X</a>
		<a class="inline-flex items-center rounded-md border border-stone-300 px-2 dark:border-gray-600" href={facebookUrl} target="_blank" rel="noopener noreferrer" data-testid="share-facebook">Facebook</a>
		<a class="inline-flex items-center rounded-md border border-stone-300 px-2 dark:border-gray-600" href={redditUrl} target="_blank" rel="noopener noreferrer" data-testid="share-reddit">Reddit</a>
		{#if canNativeShare}
			<button type="button" class="rounded-md border border-stone-300 px-2 dark:border-gray-600" data-testid="share-native" on:click={nativeShare}>Share</button>
		{/if}
	</div>
	{#if notice}
		<p class="mt-1 text-xs" role="status" data-testid="share-notice">{notice}</p>
	{/if}
</div>
