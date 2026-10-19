<script lang="ts">
	import { onMount } from 'svelte';
	import { carShareUrl, shareIntent, type ShareChannel } from '$lib/photos/carPage';
	import {
		SHARE_BRANDS,
		SHARE_BRAND_COLOR,
		SHARE_BRAND_LABEL,
		copyMark,
		nativeShareMark,
		shareMark,
		shareMarkIsDisc
	} from '$lib/photos/shareMarks';

	export let shareId: string;
	export let carName: string;
	export let imageUrl = '';
	export let compact = false;

	let notice = '';
	let canNativeShare = false;

	function pageUrl(channel?: ShareChannel): string {
		return carShareUrl(shareId, channel);
	}

	function intent(brand: (typeof SHARE_BRANDS)[number]): string {
		return shareIntent(brand, pageUrl(brand), carName, imageUrl);
	}

	onMount(() => {
		const media = window.matchMedia('(max-width: 640px), (hover: none) and (pointer: coarse)');
		const update = () => {
			canNativeShare = media.matches && typeof navigator.share === 'function';
		};
		update();
		media.addEventListener('change', update);
		return () => media.removeEventListener('change', update);
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

<div class="share-car" data-testid="share-car">
	{#if !compact}
		<label class="mb-1 block text-xs font-medium text-orange-200/80" for="car-share-link-{shareId}">Car page link</label>
		<input
			id="car-share-link-{shareId}"
			class="mb-2 w-full rounded-md border border-orange-900/60 bg-stone-950 px-2 py-1 text-sm text-orange-50"
			readonly
			value={pageUrl('copy')}
			data-testid="share-link"
		/>
	{/if}
	<div class="marks" role="group" aria-label="Share this car">
		{#each SHARE_BRANDS as brand}
			<a
				class="mark {shareMarkIsDisc(brand) ? 'disc' : `glyph ${brand}`}"
				style={shareMarkIsDisc(brand) ? `color:${SHARE_BRAND_COLOR[brand]}` : undefined}
				href={intent(brand)}
				target="_blank"
				rel="noopener noreferrer"
				aria-label="Share on {SHARE_BRAND_LABEL[brand]}"
				title="Share on {SHARE_BRAND_LABEL[brand]}"
				data-testid="share-{brand}"
			>
				{@html shareMark(brand)}
			</a>
		{/each}
		<button type="button" class="mark glyph copy" data-testid="share-copy" aria-label="Copy link" title="Copy link" on:click={copyLink}>
			{@html copyMark()}
		</button>
		{#if canNativeShare}
			<button type="button" class="mark glyph native" data-testid="share-native" aria-label="Share" title="Share" on:click={nativeShare}>
				{@html nativeShareMark()}
			</button>
		{/if}
	</div>
	{#if notice}
		<p class="mt-1 text-xs" role="status" data-testid="share-notice">{notice}</p>
	{/if}
</div>

<style>
	.marks {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
	}
	.mark {
		width: 36px;
		height: 36px;
		border-radius: 999px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: 0;
		cursor: pointer;
		text-decoration: none;
		overflow: hidden;
		flex: 0 0 36px;
		color: #fff;
	}
	.mark:focus-visible {
		outline: 2px solid #f59e0b;
		outline-offset: 2px;
	}
	.mark :global(svg) {
		display: block;
	}
	.mark.disc {
		background: #fff;
	}
	.mark.disc :global(svg) {
		width: 36px;
		height: 36px;
	}
	.mark.glyph :global(svg) {
		width: 18px;
		height: 18px;
	}
	.mark.x {
		background: #0f1419;
		box-shadow: inset 0 0 0 1px #e7e5e4;
	}
	.mark.bluesky {
		background: #1185fe;
	}
	.mark.copy {
		background: #292524;
		box-shadow: inset 0 0 0 1px #a8a29e;
	}
	.mark.native {
		background: #c2410c;
	}
</style>
