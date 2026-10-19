<script lang="ts">
	import GalleryBuddyButton from '$lib/components/GalleryBuddyButton.svelte';
	import PaintingGuideLink from '$lib/components/PaintingGuideLink.svelte';
	import ShareCar from '$lib/components/ShareCar.svelte';
	import {
		BUILD_CTA,
		VIA_GASLANDS,
		carLabel,
		htmlCardSnippet,
		iframeSnippet,
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
	$: stats = car.vehicleStats;
	$: chips = stats
		? [
				{ label: 'Hull', value: String(stats.hull) },
				{ label: 'Handling', value: String(stats.handling) },
				{ label: 'Crew', value: String(stats.crew) },
				{ label: 'Gear', value: String(stats.gear) }
			]
		: [];
	$: pills = stats ? [...stats.weapons, ...stats.upgrades, ...stats.perks].filter((name) => name.trim().length > 0) : [];
	$: extras = stats
		? [
				{ label: 'Weight', value: stats.weight },
				{ label: 'Slots', value: stats.slots },
				{ label: 'Armour', value: stats.armour },
				{ label: 'Driver', value: stats.driver }
			].filter((row) => row.value.trim().length > 0)
		: [];

	async function copySnippet(value: string, which: string) {
		try {
			await navigator.clipboard.writeText(value);
			copied = which;
		} catch {
			copied = '';
		}
	}
</script>

<article class="poster" data-testid={mode === 'embed' ? 'car-embed' : 'car-page'}>
	<figure class="hero">
		{#if mode === 'embed'}
			<a href={pageHref} target="_top">
				<img src={car.imageUrl} alt={car.caption || label} />
			</a>
		{:else}
			<img src={car.imageUrl} alt={car.caption || label} />
		{/if}
		<figcaption>
			<p class="kicker">{car.vehicleType}</p>
			<h1>
				{#if mode === 'embed'}
					<a href={pageHref} target="_top">{label}</a>
				{:else}
					{label}
				{/if}
			</h1>
			<p data-testid="car-owner">Painted by {car.displayName}</p>
			{#if mode === 'page'}
				<div class="buddy-row">
					<GalleryBuddyButton photoId={car.shareId} />
				</div>
			{/if}
		</figcaption>
	</figure>
	{#if car.paintingUrl}
		<div class="guide-row">
			<PaintingGuideLink url={car.paintingUrl} />
		</div>
	{/if}

	<div class="sheet">
		{#if mode === 'page'}
			<p class="team">
				{car.vehicleType}{#if car.teamName}<span> · {car.teamName}</span>{/if}
			</p>
			{#if car.caption}
				<p class="caption">{car.caption}</p>
			{/if}
		{/if}

		{#if stats}
			<section class="game" aria-label="Vehicle card">
				<div class="gamehead">
					<div>
						<p class="kicker">{stats.type}</p>
						<p class="game-name">{stats.name}</p>
					</div>
					<span class="cans"><span>Cans</span><b>{stats.cans}</b></span>
				</div>
				<dl class="stats" data-testid="car-stats">
					{#each chips as chip}
						<div>
							<dt>{chip.label}</dt>
							<dd>{chip.value}</dd>
						</div>
					{/each}
				</dl>
				{#if pills.length > 0}
					<ul class="pills">
						{#each pills as pill}
							<li>{pill}</li>
						{/each}
					</ul>
				{/if}
				{#if extras.length > 0}
					<dl class="extra">
						{#each extras as row}
							<div>
								<dt>{row.label}</dt>
								<dd>{row.value}</dd>
							</div>
						{/each}
					</dl>
				{/if}
			</section>
		{:else if mode === 'page'}
			<p class="quiet">This player shared the photo without the car's build.</p>
		{/if}

		{#if mode === 'embed'}
			<p class="via">
				<a href={pageHref} target="_top" data-testid="via-gaslands">{VIA_GASLANDS}</a>
			</p>
		{:else}
			<div class="share-block">
				<ShareCar shareId={car.shareId} carName={label} imageUrl={car.imageUrl} />
			</div>
			<p class="cta-row">
				<a href="/builder" data-testid="build-cta">{BUILD_CTA}</a>
			</p>
			<section class="embed-box" data-testid="embed-snippets">
				<h2>Embed this car</h2>
				<p class="quiet">
					The iframe and the HTML card both link back to this page.
					{#if embedHref}
						<a href={embedHref} data-testid="embed-preview">Preview the embed</a>.
					{/if}
				</p>
				<label for="embed-iframe">iframe</label>
				<textarea id="embed-iframe" rows="4" readonly data-testid="embed-iframe">{iframeCode}</textarea>
				<button type="button" data-testid="copy-iframe" on:click={() => copySnippet(iframeCode, 'iframe')}>Copy iframe</button>
				<label for="embed-html">HTML card</label>
				<textarea id="embed-html" rows="4" readonly data-testid="embed-html">{htmlCode}</textarea>
				<button type="button" data-testid="copy-html" on:click={() => copySnippet(htmlCode, 'html')}>Copy HTML</button>
				{#if copied}
					<p role="status">Copied the {copied}.</p>
				{/if}
			</section>
		{/if}
	</div>
</article>

<style>
	.poster {
		overflow: hidden;
		border: 1px solid #9a3412;
		border-radius: 18px;
		background:
			radial-gradient(900px 280px at 0% 0%, rgba(234, 88, 12, 0.28), transparent 55%),
			#1c1917;
		color: #fafaf9;
		box-shadow: 0 24px 50px rgba(0, 0, 0, 0.35);
	}
	.hero {
		position: relative;
		margin: 0;
	}
	.hero img {
		display: block;
		width: 100%;
		max-height: 70vh;
		aspect-ratio: 16 / 10;
		object-fit: cover;
		background: #292524;
	}
	.guide-row {
		padding: 0.85rem 1.25rem 0;
	}
	.hero figcaption {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		padding: 2.5rem 1.25rem 1rem;
		background: linear-gradient(transparent, rgba(12, 10, 9, 0.94) 62%);
	}
	.buddy-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		margin-top: 0.45rem;
	}
	.kicker {
		margin: 0;
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: #fdba74;
	}
	h1 {
		margin: 0.15rem 0 0;
		font-size: clamp(1.8rem, 4vw, 3rem);
		line-height: 1.02;
		letter-spacing: -0.03em;
	}
	h1 a {
		color: inherit;
		text-decoration: none;
	}
	h1 a:hover {
		color: #fdba74;
	}
	.sheet {
		padding: 1rem 1.25rem 1.35rem;
	}
	.team {
		margin: 0;
		color: #fdba74;
		font-weight: 700;
	}
	.caption {
		margin: 0.35rem 0 0;
		font-size: 1.05rem;
	}
	.quiet {
		color: #d6d3d1;
		font-size: 0.92rem;
	}
	.game {
		margin-top: 1rem;
		border-radius: 16px;
		border: 1px solid #c2410c;
		background:
			linear-gradient(180deg, rgba(254, 215, 170, 0.08), transparent 28%),
			radial-gradient(circle at top, #44403c, #1c1917 62%);
		padding: 0.9rem;
		box-shadow: inset 0 0 0 1px rgba(254, 215, 170, 0.12);
	}
	.gamehead {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
	}
	.game-name {
		margin: 0.1rem 0 0;
		font-size: 1.25rem;
		font-weight: 800;
	}
	.cans {
		width: 68px;
		height: 68px;
		border-radius: 999px;
		border: 2px solid #fdba74;
		background: #0c0a09;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		flex: 0 0 auto;
	}
	.cans span {
		font-size: 0.62rem;
		font-weight: 800;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: #fdba74;
	}
	.cans b {
		font-size: 1.35rem;
		line-height: 1;
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.4rem;
		margin: 0.8rem 0 0;
	}
	.stats div,
	.extra div {
		text-align: center;
		background: #0c0a09;
		border: 1px solid #9a3412;
		border-radius: 10px;
		padding: 0.35rem 0.2rem;
	}
	.stats dt,
	.extra dt {
		font-size: 0.65rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #fdba74;
	}
	.stats dd,
	.extra dd {
		margin: 0;
		font-size: 1.2rem;
		font-weight: 800;
	}
	.pills {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin: 0.75rem 0 0;
		padding: 0;
		list-style: none;
	}
	.pills li {
		border: 1px solid #c2410c;
		background: #431407;
		color: #ffedd5;
		border-radius: 999px;
		padding: 0.15rem 0.55rem;
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.extra {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.4rem;
		margin: 0.75rem 0 0;
	}
	.extra dd {
		font-size: 0.95rem;
	}
	.share-block {
		margin-top: 1.1rem;
	}
	.cta-row {
		margin: 1rem 0 0;
	}
	.cta-row a {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		padding: 0.55rem 0.95rem;
		background: linear-gradient(180deg, #fbbf24, #c2410c);
		color: #1c1917;
		font-weight: 800;
		text-decoration: none;
	}
	.embed-box {
		margin-top: 1.5rem;
		padding-top: 1rem;
		border-top: 1px solid #44403c;
	}
	.embed-box h2 {
		margin: 0;
		font-size: 1.15rem;
	}
	.embed-box a {
		color: #fdba74;
	}
	label {
		display: block;
		margin-top: 0.75rem;
		font-size: 0.85rem;
		font-weight: 700;
	}
	textarea {
		width: 100%;
		box-sizing: border-box;
		margin-top: 0.25rem;
		border-radius: 8px;
		border: 1px solid #44403c;
		background: #0c0a09;
		color: #fafaf9;
		font: 0.75rem ui-monospace, monospace;
		padding: 0.45rem;
	}
	button {
		margin-top: 0.35rem;
		border-radius: 8px;
		border: 1px solid #78716c;
		background: #292524;
		color: #fafaf9;
		padding: 0.3rem 0.65rem;
		cursor: pointer;
	}
	.via {
		margin: 0.9rem 0 0;
	}
	.via a {
		color: #fdba74;
		font-weight: 700;
	}
</style>
