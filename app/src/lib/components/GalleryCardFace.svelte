<script lang="ts">
	import PaintingGuideLink from '$lib/components/PaintingGuideLink.svelte';
	import { galleryCarName } from '$lib/photos/galleryQuery';
	import type { GalleryPhoto } from '$lib/services/photoShare';

	export let photo: GalleryPhoto;
	export let layout: 'card' | 'detail' = 'card';
	export let photosOnly = false;

	$: stats = photo.vehicleStats;
	$: title = galleryCarName(photo);
	$: pills = stats ? [...stats.weapons, ...stats.upgrades].filter((name) => name.trim().length > 0) : [];
	$: shownPills = pills;

	/**
	 * Card layout: keep the weapon chips to two rows. Chips that would start a
	 * third row are hidden and counted in a "+N" chip, which always stays visible.
	 */
	function fitPills(list: HTMLUListElement, options: { enabled: boolean; count: number }) {
		let current = options;
		const fit = () => {
			const items = Array.from(list.querySelectorAll<HTMLElement>('[data-pill]'));
			const more = list.querySelector<HTMLElement>('[data-pill-more]');
			if (!more) return;
			for (const item of items) item.hidden = false;
			more.hidden = true;
			if (!current.enabled) return;
			const overflows = () => list.scrollHeight > list.clientHeight + 1;
			let hidden = 0;
			if (!overflows()) return;
			more.hidden = false;
			for (let index = items.length - 1; index >= 0 && overflows(); index -= 1) {
				items[index].hidden = true;
				hidden += 1;
				more.textContent = `+${hidden}`;
			}
		};
		const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => fit());
		observer?.observe(list);
		queueMicrotask(fit);
		return {
			update(next: { enabled: boolean; count: number }) {
				current = next;
				queueMicrotask(fit);
			},
			destroy() {
				observer?.disconnect();
			}
		};
	}
	$: chips = stats
		? [
				{ label: 'Hull', value: String(stats.hull) },
				{ label: 'Handling', value: String(stats.handling) },
				{ label: 'Crew', value: String(stats.crew) },
				{ label: 'Gear', value: String(stats.gear) }
			]
		: [];
</script>

{#if photosOnly}
	<div class="photo-frame">
		<img src={photo.url} alt={photo.caption || `${title}, ${photo.vehicleType}`} />
		<div class="photo-meta" data-testid="gallery-hover-meta">
			<p class="truncate text-sm font-black uppercase tracking-wide text-orange-50">{title}</p>
			<p class="truncate text-xs font-medium text-orange-300">{photo.displayName}</p>
		</div>
	</div>
{:else}
	<div class="overflow-hidden rounded-xl border border-orange-900/50 bg-stone-950 text-orange-50 shadow-lg shadow-black/40 {layout === 'detail' ? '' : 'flex h-full flex-col'}" data-testid={layout === 'card' ? 'gallery-card-face' : undefined}>
		<div class="relative {layout === 'detail' ? 'aspect-video max-h-[46vh]' : 'aspect-[4/3]'} bg-stone-900">
			<img
				src={photo.url}
				alt={photo.caption || `${title}, ${photo.vehicleType}`}
				class="h-full w-full object-cover transition duration-300 {layout === 'card' ? 'group-hover:scale-105 group-focus-visible:scale-105' : ''}"
			/>
			<div class="pointer-events-none absolute inset-0 bg-gradient-to-t from-stone-950 via-stone-950/10 to-stone-950/20"></div>
			<span
				class="absolute left-2 top-2 rounded-sm bg-orange-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow"
				data-testid="gallery-type-badge"
			>
				{photo.vehicleType}
			</span>
			{#if stats}
				<span
					class="absolute right-2 top-2 flex h-12 w-12 flex-col items-center justify-center rounded-full border-2 border-orange-300 bg-stone-950/90 text-orange-100 shadow"
					data-testid="gallery-cans"
				>
					<span class="text-[8px] font-bold uppercase leading-none tracking-wide">Cans</span>
					<span class="text-sm font-black leading-none">{stats.cans}</span>
				</span>
			{/if}
		</div>
		<div class="card-body space-y-2 bg-[radial-gradient(circle_at_top,_#44403c,_#1c1917_58%)] px-3 py-3" class:card-body-fixed={layout === 'card'}>
			<div>
				<p class="{layout === 'detail' ? 'text-xl' : 'text-sm'} truncate font-black uppercase tracking-wide text-orange-50">{title}</p>
				<p class="truncate text-xs font-medium text-orange-300">{photo.displayName}</p>
			</div>
			{#if layout === 'detail'}
				<PaintingGuideLink url={photo.paintingUrl} />
			{/if}
			{#if stats}
				<dl class="grid grid-cols-4 gap-1" data-testid="gallery-stats">
					{#each chips as chip}
						<div class="rounded-md border border-orange-900/60 bg-stone-950/70 px-1 py-1 text-center">
							<dt class="text-[9px] font-semibold uppercase tracking-wide text-orange-300/90">{chip.label}</dt>
							<dd class="text-sm font-black leading-tight text-orange-50">{chip.value}</dd>
						</div>
					{/each}
				</dl>
				{#if shownPills.length > 0}
					<ul class="flex flex-wrap gap-1" class:pills-clamp={layout === 'card'} data-testid="gallery-pills" use:fitPills={{ enabled: layout === 'card', count: pills.length }}>
						{#each shownPills as pill}
							<li data-pill class="max-w-full truncate rounded-full border border-orange-800/80 bg-orange-950/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-100">
								{pill}
							</li>
						{/each}
						<li data-pill-more class="rounded-full bg-stone-800 px-2 py-0.5 text-[10px] font-semibold text-orange-200" hidden>+0</li>
					</ul>
				{/if}
				{#if stats.weight || stats.slots}
					<footer class="card-footer flex items-center justify-between border-t border-orange-900/70 pt-2 text-[10px] font-bold uppercase tracking-wider text-orange-200/90">
						<span>{stats.weight ? `Wt ${stats.weight}` : ''}</span>
						<span>{stats.slots ? `Slots ${stats.slots}` : ''}</span>
					</footer>
				{/if}
			{:else}
				<p class="text-[10px] font-semibold uppercase tracking-wider text-stone-400" data-testid="gallery-photo-only">Photo</p>
			{/if}
		</div>
	</div>
{/if}

<style>
	/* Every With details card has the same body height: room for the title, the
	   stat chips, two rows of weapon chips, and the footer pinned to the bottom. */
	.card-body-fixed {
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		height: 12.5rem;
		overflow: hidden;
	}
	.card-body-fixed > :global(*) {
		flex-shrink: 0;
	}
	.pills-clamp {
		max-height: calc(2 * 1.25rem + 0.25rem);
		overflow: hidden;
	}
	.card-body-fixed .card-footer {
		margin-top: auto;
	}
	.photo-frame {
		position: relative;
		width: 100%;
		aspect-ratio: 1 / 1;
		overflow: hidden;
		border-radius: 6px;
		background: #1c1917;
	}
	.photo-frame img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.photo-meta {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		padding: 0.55rem 0.65rem 1.4rem;
		background: linear-gradient(to bottom, rgba(12, 10, 9, 0.88), transparent);
	}
</style>
