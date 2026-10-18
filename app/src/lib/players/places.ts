import { assessLocation } from './location';

/**
 * PlaceAutocompleteElement collection for cities (locality and
 * administrative_area_level_3). It cannot be combined with other types.
 * Street addresses and businesses are not requested.
 */
export const CITY_PRIMARY_TYPES = ['(cities)'] as const;

type PlaceText = { text?: unknown } | string | null | undefined;

export type PredictionLike = {
	text?: PlaceText;
	mainText?: PlaceText;
	secondaryText?: PlaceText;
	toPlace?: () => unknown;
};

export type PlaceAutocompleteElement = HTMLElement & {
	placeholder: string;
	value: string;
	includedPrimaryTypes?: string[];
};

export type PlacesLibrary = {
	PlaceAutocompleteElement: new (options?: { includedPrimaryTypes?: string[] }) => PlaceAutocompleteElement;
};

type MapsNamespace = {
	importLibrary?: (name: string) => Promise<PlacesLibrary>;
	__ib__?: () => void;
};

const AUTH_FAILURE = 'gaslands-maps-auth-failure';

export function mapsAuthFailureEvent(): string {
	return AUTH_FAILURE;
}

export function mapsBrowserKey(env: { VITE_GOOGLE_MAPS_API_KEY?: string } | undefined = import.meta.env): string {
	return (env?.VITE_GOOGLE_MAPS_API_KEY ?? '').trim();
}

export function readPlaceText(value: PlaceText): string {
	if (typeof value === 'string') return value.trim();
	if (value && typeof value === 'object' && typeof value.text === 'string') return value.text.trim();
	return '';
}

/** A suggestion may be stored only when it is already a city, region, or ZIP. */
export function acceptPlaceLabel(raw: string): string | null {
	const assessed = assessLocation(raw);
	if (!assessed.ok || !assessed.label) return null;
	return assessed.label;
}

/**
 * Builds a label from the prediction text. Precise results are dropped.
 * The prediction's place id and coordinates are never read.
 */
export function cityLabelFromPrediction(prediction: PredictionLike | null | undefined): string | null {
	if (!prediction) return null;
	const main = readPlaceText(prediction.mainText);
	const secondary = readPlaceText(prediction.secondaryText);
	const combined = [main, secondary].filter(Boolean).join(', ');
	return acceptPlaceLabel(combined) ?? acceptPlaceLabel(readPlaceText(prediction.text));
}

function mapsNamespace(): MapsNamespace | null {
	if (typeof window === 'undefined') return null;
	const host = window as Window & { google?: { maps?: MapsNamespace } };
	const google = (host.google = host.google ?? {});
	google.maps = google.maps ?? {};
	return google.maps;
}

let booted = false;
let authHooked = false;

function installAuthFailureHook(): void {
	if (authHooked || typeof window === 'undefined') return;
	authHooked = true;
	const host = window as Window & { gm_authFailure?: () => void };
	const previous = host.gm_authFailure;
	host.gm_authFailure = () => {
		previous?.();
		window.dispatchEvent(new CustomEvent(AUTH_FAILURE));
	};
}

/**
 * Loads the Maps JavaScript API the first time the profile field asks for it.
 * The script is not added on other pages. No map, no geocoding, no geometry.
 */
export function bootGoogleMaps(key: string): void {
	if (!key || typeof document === 'undefined' || booted) return;
	const maps = mapsNamespace();
	if (!maps) return;
	if (typeof maps.importLibrary === 'function') {
		booted = true;
		return;
	}
	booted = true;
	installAuthFailureHook();

	((g: Record<string, string>) => {
		let loading: Promise<void> | undefined;
		let script: HTMLScriptElement;
		const message = 'The Google Maps JavaScript API';
		const callback = '__ib__';
		const requested = new Set<string>();
		const params = new URLSearchParams();
		const start = () =>
			loading ||
			(loading = new Promise<void>((resolve, reject) => {
				script = document.createElement('script');
				params.set('libraries', [...requested].join(','));
				for (const name of Object.keys(g)) {
					params.set(name.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`), g[name]);
				}
				params.set('callback', `google.maps.${callback}`);
				script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
				script.async = true;
				(maps as MapsNamespace & Record<string, unknown>)[callback] = () => resolve();
				script.onerror = () => {
					loading = undefined;
					reject(new Error(`${message} could not load.`));
				};
				const nonce = document.querySelector('script[nonce]')?.getAttribute('nonce');
				if (nonce) script.nonce = nonce;
				document.head.append(script);
			}));
		const stub = (name: string): Promise<PlacesLibrary> => {
			requested.add(name);
			return start().then(() => {
				const current = maps.importLibrary;
				if (!current || current === stub) throw new Error(`${message} could not load.`);
				return current(name);
			});
		};
		maps.importLibrary = stub;
	})({ key, v: 'weekly' });
}

export async function loadPlaceAutocomplete(): Promise<PlacesLibrary | null> {
	const key = mapsBrowserKey();
	if (!key || typeof window === 'undefined') return null;
	bootGoogleMaps(key);
	const maps = mapsNamespace();
	if (!maps?.importLibrary) return null;
	try {
		const lib = await maps.importLibrary('places');
		if (typeof lib?.PlaceAutocompleteElement !== 'function') return null;
		return lib;
	} catch {
		return null;
	}
}
