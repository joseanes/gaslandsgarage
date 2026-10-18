<script lang="ts">
	import { onMount } from 'svelte';
	import {
		acceptPlaceLabel,
		CITY_PRIMARY_TYPES,
		cityLabelFromPrediction,
		loadPlaceAutocomplete,
		mapsAuthFailureEvent,
		mapsBrowserKey,
		type PlaceAutocompleteElement,
		type PredictionLike
	} from '$lib/players/places';

	export let value = '';
	export let inputClass = '';

	const placeholder = 'City and region, or a 5-digit ZIP';

	let state: 'loading' | 'places' | 'plain' = mapsBrowserKey() ? 'loading' : 'plain';
	let host: HTMLDivElement;
	let fallback: HTMLInputElement;
	let widget: PlaceAutocompleteElement | null = null;
	let lastGood = acceptPlaceLabel(value) ?? '';

	function predictionFrom(event: Event): PredictionLike | null {
		if (!('placePrediction' in event)) return null;
		const prediction = (event as Event & { placePrediction?: PredictionLike }).placePrediction;
		return prediction ?? null;
	}

	function remember(next: string) {
		const accepted = acceptPlaceLabel(next);
		if (next.trim() === '') lastGood = '';
		else if (accepted) lastGood = accepted;
	}

	function publish(next: string) {
		value = next;
		remember(next);
	}

	function focusWidget(el: PlaceAutocompleteElement, restore: boolean) {
		if (!restore) return;
		el.focus();
	}

	function focusWidgetFromFallback() {
		if (state === 'places' && widget) widget.focus();
	}

	onMount(() => {
		if (!mapsBrowserKey()) {
			state = 'plain';
			return;
		}

		let cancelled = false;
		let ignoreLate = false;
		let detach = () => {};
		const timer = window.setTimeout(() => {
			if (cancelled || state !== 'loading') return;
			ignoreLate = true;
			state = 'plain';
		}, 8000);

		const onAuthFailure = () => {
			detach();
			widget = null;
			state = 'plain';
		};
		window.addEventListener(mapsAuthFailureEvent(), onAuthFailure);

		void (async () => {
			const places = await loadPlaceAutocomplete();
			if (cancelled || ignoreLate || !places || !host) {
				if (!cancelled && state === 'loading') state = 'plain';
				window.clearTimeout(timer);
				return;
			}
			window.clearTimeout(timer);
			const restoreFocus = document.activeElement === fallback;
			const el = new places.PlaceAutocompleteElement({
				includedPrimaryTypes: [...CITY_PRIMARY_TYPES]
			});
			el.includedPrimaryTypes = [...CITY_PRIMARY_TYPES];
			el.placeholder = placeholder;
			el.className = 'location-places';
			el.dataset.testid = 'profile-location-suggest';
			el.setAttribute('aria-labelledby', 'player-location-label');
			el.value = value;
			remember(value);

			const onType = () => publish(el.value);
			const onSelect = (event: Event) => {
				const label = cityLabelFromPrediction(predictionFrom(event));
				if (!label) {
					el.value = lastGood;
					value = lastGood;
					return;
				}
				el.value = label;
				lastGood = label;
				value = label;
			};
			el.addEventListener('input', onType);
			el.addEventListener('gmp-select', onSelect);
			host.replaceChildren(el);
			widget = el;
			state = 'places';
			focusWidget(el, restoreFocus);
			detach = () => {
				el.removeEventListener('input', onType);
				el.removeEventListener('gmp-select', onSelect);
				el.remove();
			};
		})();

		return () => {
			cancelled = true;
			window.clearTimeout(timer);
			window.removeEventListener(mapsAuthFailureEvent(), onAuthFailure);
			detach();
		};
	});

	function widgetFocused(): boolean {
		if (!widget || typeof document === 'undefined') return false;
		const active = document.activeElement;
		return active === widget || (!!active && widget.contains(active));
	}

	$: remember(value);
	$: if (widget && state === 'places' && !widgetFocused() && widget.value !== value) {
		widget.value = value;
	}
</script>

<label id="player-location-label" for="player-location" class="mb-1 block text-sm font-medium">
	General location
</label>
<div class="min-w-0" data-testid="profile-location-status" data-state={state}>
	<div class="places-host" class:hidden={state !== 'places'} bind:this={host}></div>
	<input
		bind:this={fallback}
		id="player-location"
		class={inputClass}
		hidden={state === 'places'}
		maxlength="80"
		{placeholder}
		bind:value
		data-testid="profile-location"
		autocomplete="off"
		aria-hidden={state === 'places' ? 'true' : undefined}
		tabindex={state === 'places' ? -1 : undefined}
		on:focus={focusWidgetFromFallback}
	/>
</div>

<style>
	.hidden {
		display: none;
	}

	.places-host:not(.hidden) :global(.location-places) {
		display: block;
		width: 100%;
		border-radius: 0.5rem;
		color-scheme: light;
		/* The mobile widget opens a fixed full-screen list. Keep it above the page. */
		position: relative;
		z-index: 40;
	}

	.places-host:not(.hidden) :global(.location-places::part(input)) {
		width: 100%;
		border: 1px solid #d6d3d1;
		border-radius: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: #fff;
		color: #292524;
		font: inherit;
	}

	:global(.dark) .places-host:not(.hidden) :global(.location-places),
	:global(.dark-mode) .places-host:not(.hidden) :global(.location-places) {
		color-scheme: dark;
	}

	:global(.dark) .places-host:not(.hidden) :global(.location-places::part(input)),
	:global(.dark-mode) .places-host:not(.hidden) :global(.location-places::part(input)) {
		border-color: #4b5563;
		background: #1f2937;
		color: #f3f4f6;
	}
</style>
