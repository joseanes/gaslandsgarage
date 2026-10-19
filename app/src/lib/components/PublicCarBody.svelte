<script lang="ts">
	import ShareCar from '$lib/components/ShareCar.svelte';
	import {
		BUILD_CTA,
		VIA_GASLANDS,
		carLabel,
		htmlCardSnippet,
		iframeSnippet,
		statRows,
		type PublicCar
	} from '$lib/photos/carPage';

	export let car: PublicCar;
	export let mode: 'page' | 'embed' = 'page';
	export let carPageHref = '';
	export let embedHref = '';

	let copied = '';

	$: label = carLabel(car);
	$: pageHref = carPageHref || `/car/${car.shareId}`;
	$: iframeCode = iframeSnippet(car.shareId, label);
	$: htmlCode = htmlCardSnippet(car);
	$: rows = car.vehicleStats ? statRows(car.vehicleStats) : [];

	async function copySnippet(value: string, which: string) {
		try {
			await navigator.clipboard.writeText(value);
			copied = which;
		} catch {
			copied = '';
		}
	}
</script>

<article class="text-stone-800 dark:text-gray-100" data-testid={mode === 'embed' ? 'car-embed' : 'car-page'}>
	{#if mode === 'embed'}
		<a href={pageHref} target="_top">
			<img src={car.imageUrl} alt={car.caption || label} class="aspect-[8/5] w-full rounded-lg bg-stone-200 object-cover" />
		</a>
	{:else}
		<img src={car.imageUrl} alt={car.caption || label} class="max-h-[70vh] w-full rounded-lg bg-stone-200 object-cover" />
	{/if}

	<h1 class="mt-3 text-2xl font-bold leading-tight">
		{#if mode === 'embed'}
			<a href={pageHref} target="_top" class="text-amber-800 underline-offset-2 hover:underline dark:text-amber-300">{label}</a>
		{:else}
			{label}
		{/if}
	</h1>
	<p class="mt-1" data-testid="car-owner">Painted by {car.displayName}</p>
	{#if mode === 'page'}
		<p class="text-stone-600 dark:text-gray-300">
			{car.vehicleType}{#if car.teamName} · {car.teamName}{/if}
		</p>
		{#if car.caption}
			<p class="mt-2">{car.caption}</p>
		{/if}
	{/if}

	{#if rows.length > 0}
		<dl class="mt-4 grid grid-cols-2 gap-2 text-sm" data-testid="car-stats">
			{#each rows as row}
				<div>
					<dt class="text-xs font-medium text-stone-500 dark:text-gray-400">{row.label}</dt>
					<dd>{row.value}</dd>
				</div>
			{/each}
		</dl>
	{:else if mode === 'page'}
		<p class="mt-4 text-sm text-stone-600 dark:text-gray-300">This player shared the photo without the car's build.</p>
	{/if}

	{#if mode === 'embed'}
		<p class="mt-3 text-sm">
			<a href={pageHref} target="_top" class="font-medium text-amber-800 underline dark:text-amber-300" data-testid="via-gaslands">{VIA_GASLANDS}</a>
		</p>
	{:else}
		<div class="mt-5">
			<ShareCar shareId={car.shareId} carName={label} />
		</div>
		<p class="mt-5">
			<a href="/builder" class="amber-button rounded-lg px-4 text-sm font-semibold" data-testid="build-cta">{BUILD_CTA}</a>
		</p>
		<section class="mt-8" data-testid="embed-snippets">
			<h2 class="text-lg font-semibold">Embed this car</h2>
			<p class="mt-1 text-sm text-stone-600 dark:text-gray-300">
				The iframe and the HTML card both link back to this page.
				{#if embedHref}
					<a class="text-amber-800 underline dark:text-amber-300" href={embedHref} data-testid="embed-preview">Preview the embed</a>.
				{/if}
			</p>
			<label class="mt-3 block text-sm font-medium" for="embed-iframe">iframe</label>
			<textarea id="embed-iframe" class="mt-1 w-full rounded-md border border-stone-300 bg-white p-2 font-mono text-xs dark:border-gray-600 dark:bg-gray-800" rows="4" readonly data-testid="embed-iframe">{iframeCode}</textarea>
			<button type="button" class="mt-1 rounded-md border border-stone-300 px-3 py-1 text-sm dark:border-gray-600" data-testid="copy-iframe" on:click={() => copySnippet(iframeCode, 'iframe')}>Copy iframe</button>
			<label class="mt-3 block text-sm font-medium" for="embed-html">HTML card</label>
			<textarea id="embed-html" class="mt-1 w-full rounded-md border border-stone-300 bg-white p-2 font-mono text-xs dark:border-gray-600 dark:bg-gray-800" rows="4" readonly data-testid="embed-html">{htmlCode}</textarea>
			<button type="button" class="mt-1 rounded-md border border-stone-300 px-3 py-1 text-sm dark:border-gray-600" data-testid="copy-html" on:click={() => copySnippet(htmlCode, 'html')}>Copy HTML</button>
			{#if copied}
				<p class="mt-2 text-sm" role="status">Copied the {copied}.</p>
			{/if}
		</section>
	{/if}
</article>
