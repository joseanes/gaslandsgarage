import { presentMapMarker, type MapMarker } from './profile';

export const MAP_CACHE_KEY = 'gaslands.playerMap.v1';
export const OPEN_CACHE_KEY = 'gaslands.openPlayers.v1';
/** Repeat visits inside this window reuse the last board read. */
export const DIRECTORY_CACHE_TTL_MS = 5 * 60 * 1000;

export type OpenPlayer = { uid: string; playerName: string; bio: string; playSpots: string };

type Envelope = { storedAt: number; value: unknown };

/**
 * Copy a board map and set or remove one key. Other keys are left as they were.
 * Firestore rules reject the write unless that key belongs to the signed-in player.
 */
export function applyBoardField(current: unknown, key: string, entry: object | null): Record<string, unknown> {
	const next: Record<string, unknown> = {};
	if (current && typeof current === 'object' && !Array.isArray(current)) {
		for (const [id, value] of Object.entries(current as Record<string, unknown>)) {
			next[id] = value;
		}
	}
	if (entry) next[key] = entry;
	else delete next[key];
	return next;
}

export function markersFromBoard(data: Record<string, unknown> | undefined): MapMarker[] {
	const markers: MapMarker[] = [];
	const field = data?.markers;
	if (!field || typeof field !== 'object' || Array.isArray(field)) return markers;
	for (const [id, value] of Object.entries(field as Record<string, unknown>)) {
		if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
		const marker = presentMapMarker(id, value as Record<string, unknown>);
		if (marker) markers.push(marker);
	}
	return markers;
}

export function openPlayersFromBoard(data: Record<string, unknown> | undefined): OpenPlayer[] {
	const field = data?.players;
	if (!field || typeof field !== 'object' || Array.isArray(field)) return [];
	const players: OpenPlayer[] = [];
	for (const [uid, value] of Object.entries(field as Record<string, unknown>)) {
		if (!uid || !value || typeof value !== 'object' || Array.isArray(value)) continue;
		const card = value as Record<string, unknown>;
		players.push({
			uid,
			playerName: typeof card.playerName === 'string' && card.playerName ? card.playerName : 'Player',
			bio: typeof card.bio === 'string' ? card.bio : '',
			playSpots: typeof card.playSpots === 'string' ? card.playSpots : ''
		});
	}
	return players;
}

export function isCachedMarkerList(value: unknown): value is MapMarker[] {
	return (
		Array.isArray(value) &&
		value.every((item) => {
			if (!item || typeof item !== 'object') return false;
			const marker = item as Partial<MapMarker>;
			return (
				typeof marker.id === 'string' &&
				typeof marker.anonymous === 'boolean' &&
				typeof marker.lat === 'number' &&
				typeof marker.lng === 'number' &&
				typeof marker.playerName === 'string'
			);
		})
	);
}

export function isCachedOpenPlayerList(value: unknown): value is OpenPlayer[] {
	return (
		Array.isArray(value) &&
		value.every((item) => {
			if (!item || typeof item !== 'object') return false;
			const player = item as Partial<OpenPlayer>;
			return typeof player.uid === 'string' && typeof player.playerName === 'string';
		})
	);
}

export function readDirectoryCache<T>(
	storage: Pick<Storage, 'getItem'> | undefined,
	key: string,
	now: number,
	ttlMs: number,
	accept: (value: unknown) => value is T
): T | null {
	if (!storage) return null;
	try {
		const raw = storage.getItem(key);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<Envelope>;
		if (typeof parsed?.storedAt !== 'number' || !Number.isFinite(parsed.storedAt)) return null;
		if (now - parsed.storedAt >= ttlMs) return null;
		return accept(parsed.value) ? parsed.value : null;
	} catch {
		return null;
	}
}

export function writeDirectoryCache(
	storage: Pick<Storage, 'setItem'> | undefined,
	key: string,
	value: unknown,
	now: number
): void {
	if (!storage) return;
	try {
		storage.setItem(key, JSON.stringify({ storedAt: now, value }));
	} catch {
		// A full sessionStorage should not block the page. The next visit reads Firestore.
	}
}

export function clearDirectoryCache(storage: Pick<Storage, 'removeItem'> | undefined): void {
	if (!storage) return;
	try {
		storage.removeItem(MAP_CACHE_KEY);
		storage.removeItem(OPEN_CACHE_KEY);
	} catch {
		// Ignore storage that is unavailable in this browser mode.
	}
}
