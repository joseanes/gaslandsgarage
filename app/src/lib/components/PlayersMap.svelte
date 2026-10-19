<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type { Map as LeafletMap, Marker } from 'leaflet';
	import { basemapFor } from '$lib/players/basemap';
	import { escapeText, type MapMarker } from '$lib/players/profile';
	import 'leaflet/dist/leaflet.css';

	export let markers: MapMarker[] = [];

	let host: HTMLDivElement;
	let map: LeafletMap | null = null;
	let pins: Marker[] = [];
	let fitted = false;
	let api: typeof import('leaflet') | null = null;

	function leafletApi(loaded: typeof import('leaflet') & { default?: typeof import('leaflet') }) {
		if (typeof loaded.map === 'function') return loaded;
		if (loaded.default && typeof loaded.default.map === 'function') return loaded.default;
		return loaded;
	}

	function popup(marker: MapMarker): string {
		if (marker.anonymous) {
			return '<strong>Anonymous player</strong><p>Approximate area only. No name is shared.</p>';
		}
		const parts = [`<strong>${escapeText(marker.playerName || 'Player')}</strong>`];
		if (marker.locationLabel) parts.push(`<p>${escapeText(marker.locationLabel)}</p>`);
		if (marker.playSpots) parts.push(`<p>${escapeText(marker.playSpots)}</p>`);
		if (marker.bio) parts.push(`<p>${escapeText(marker.bio)}</p>`);
		if (marker.openToGames) parts.push('<p>Open to a game. Contact stays in the app.</p>');
		return parts.join('');
	}

	function sync() {
		if (!map || !api) return;
		for (const pin of pins) pin.remove();
		pins = [];
		for (const marker of markers) {
			const icon = api.divIcon({
				className: 'player-marker',
				html: `<span class="player-marker-dot ${marker.anonymous ? 'is-anon' : 'is-named'}" data-player-name="${marker.anonymous ? '' : escapeText(marker.playerName)}"></span>`,
				iconSize: [18, 18],
				iconAnchor: [9, 9]
			});
			const pin = api.marker([marker.lat, marker.lng], {
				icon,
				keyboard: true,
				alt: marker.anonymous ? 'Anonymous player' : marker.playerName || 'Player'
			});
			pin.bindPopup(popup(marker));
			pin.addTo(map);
			pins.push(pin);
		}
		if (!fitted && pins.length > 0) {
			map.fitBounds(api.featureGroup(pins).getBounds().pad(0.4), { maxZoom: 8 });
			fitted = true;
		}
	}

	onMount(async () => {
		const loaded = leafletApi(await import('leaflet'));
		api = loaded;
		map = loaded.map(host, { minZoom: 2, maxZoom: 12 });
		const basemap = basemapFor(import.meta.env.VITE_CARTO_BASEMAPS_KEY);
		loaded.tileLayer(basemap.url, basemap.options).addTo(map);
		map.setView([20, 0], 2);
		sync();
	});

	$: markerKey = markers.map((marker) => `${marker.id}:${marker.lat}:${marker.lng}:${marker.anonymous}:${marker.playerName}`).join('|');
	$: if (map && markerKey !== undefined) sync();

	onDestroy(() => {
		map?.remove();
		map = null;
	});
</script>

<div class="players-map overflow-hidden rounded-lg border border-stone-300 dark:border-gray-600">
	<div bind:this={host} class="h-[28rem] w-full sm:h-[36rem]" data-testid="players-map"></div>
</div>

<style>
	:global(.player-marker) {
		background: transparent;
		border: none;
	}

	:global(.player-marker-dot) {
		display: block;
		width: 16px;
		height: 16px;
		border-radius: 9999px;
		border: 2px solid white;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45);
	}

	:global(.player-marker-dot.is-named) {
		background: #b45309;
	}

	:global(.player-marker-dot.is-anon) {
		background: #57534e;
	}

	/* Leaflet panes use z-index 200–700 and controls use 1000. Trap them here
	   so header menus and dialogs (z-index 10–70) stay above the map. */
	.players-map,
	.players-map :global(.leaflet-container) {
		position: relative;
		z-index: 0;
		isolation: isolate;
	}

	:global(.leaflet-container) {
		font: inherit;
		background: #e7e5e4;
	}
</style>
