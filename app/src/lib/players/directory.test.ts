import { describe, expect, it } from 'vitest';
import {
	DIRECTORY_CACHE_TTL_MS,
	MAP_CACHE_KEY,
	OPEN_CACHE_KEY,
	applyBoardField,
	clearDirectoryCache,
	isCachedMarkerList,
	markersFromBoard,
	openPlayersFromBoard,
	readDirectoryCache,
	writeDirectoryCache
} from './directory';

function memoryStorage() {
	const store = new Map<string, string>();
	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => {
			store.set(key, value);
		},
		removeItem: (key: string) => {
			store.delete(key);
		}
	};
}

describe('applyBoardField', () => {
	it('changes one key and keeps every other entry', () => {
		const current = { ada: { playerName: 'Ada' }, bea: { playerName: 'Bea' } };
		const next = applyBoardField(current, 'bea', { playerName: 'Bea 2' });
		expect(next).toEqual({ ada: { playerName: 'Ada' }, bea: { playerName: 'Bea 2' } });
		expect(current.bea).toEqual({ playerName: 'Bea' });
	});

	it('removes only the requested key', () => {
		expect(applyBoardField({ ada: { playerName: 'Ada' }, bea: { playerName: 'Bea' } }, 'ada', null)).toEqual({
			bea: { playerName: 'Bea' }
		});
	});

	it('starts a board from a missing or unusable field', () => {
		expect(applyBoardField(undefined, 'ada', { playerName: 'Ada' })).toEqual({ ada: { playerName: 'Ada' } });
		expect(applyBoardField(['ada'], 'bea', { playerName: 'Bea' })).toEqual({ bea: { playerName: 'Bea' } });
	});
});

describe('board readers', () => {
	it('reads public pins and drops an anonymous name', () => {
		expect(
			markersFromBoard({
				markers: {
					anon: { anonymous: true, latE2: 3011, lngE2: -9802, playerName: 'Ada', updatedAt: 'now' },
					named: {
						anonymous: false,
						playerName: 'Bea',
						bio: '',
						playSpots: '',
						locationLabel: 'Austin, TX',
						latE2: 3019,
						lngE2: -9766,
						openToGames: true,
						updatedAt: 'now'
					},
					broken: { anonymous: true, latE2: 1.5, lngE2: 2 }
				}
			})
		).toEqual([
			{
				id: 'anon',
				anonymous: true,
				lat: 30.11,
				lng: -98.02,
				playerName: '',
				bio: '',
				playSpots: '',
				locationLabel: '',
				openToGames: false
			},
			{
				id: 'named',
				anonymous: false,
				lat: 30.19,
				lng: -97.66,
				playerName: 'Bea',
				bio: '',
				playSpots: '',
				locationLabel: 'Austin, TX',
				openToGames: true
			}
		]);
		expect(markersFromBoard(undefined)).toEqual([]);
	});

	it('reads contact cards by their map key and ignores a nested uid', () => {
		expect(
			openPlayersFromBoard({
				players: {
					player: { playerName: 'Ada', bio: 'Rookie', playSpots: 'At home', uid: 'someone-else' },
					blank: { bio: 'No name' }
				}
			})
		).toEqual([
			{ uid: 'player', playerName: 'Ada', bio: 'Rookie', playSpots: 'At home' },
			{ uid: 'blank', playerName: 'Player', bio: 'No name', playSpots: '' }
		]);
	});
});

describe('directory cache', () => {
	it('returns a fresh list and drops it after the ttl', () => {
		const storage = memoryStorage();
		const markers = [
			{
				id: 'pin',
				anonymous: true,
				lat: 1,
				lng: 2,
				playerName: '',
				bio: '',
				playSpots: '',
				locationLabel: '',
				openToGames: false
			}
		];
		writeDirectoryCache(storage, MAP_CACHE_KEY, markers, 1_000);
		expect(readDirectoryCache(storage, MAP_CACHE_KEY, 1_000 + DIRECTORY_CACHE_TTL_MS - 1, DIRECTORY_CACHE_TTL_MS, isCachedMarkerList)).toEqual(
			markers
		);
		expect(
			readDirectoryCache(storage, MAP_CACHE_KEY, 1_000 + DIRECTORY_CACHE_TTL_MS, DIRECTORY_CACHE_TTL_MS, isCachedMarkerList)
		).toBeNull();
	});

	it('ignores malformed cache entries', () => {
		const storage = memoryStorage();
		storage.setItem(OPEN_CACHE_KEY, '{');
		expect(readDirectoryCache(storage, OPEN_CACHE_KEY, 5, DIRECTORY_CACHE_TTL_MS, Array.isArray)).toBeNull();
		storage.setItem(MAP_CACHE_KEY, JSON.stringify({ storedAt: 1, value: [{ id: 'pin' }] }));
		expect(readDirectoryCache(storage, MAP_CACHE_KEY, 2, DIRECTORY_CACHE_TTL_MS, isCachedMarkerList)).toBeNull();
	});

	it('clears both boards', () => {
		const storage = memoryStorage();
		writeDirectoryCache(storage, MAP_CACHE_KEY, [], 1);
		writeDirectoryCache(storage, OPEN_CACHE_KEY, [], 1);
		clearDirectoryCache(storage);
		expect(storage.getItem(MAP_CACHE_KEY)).toBeNull();
		expect(storage.getItem(OPEN_CACHE_KEY)).toBeNull();
	});
});
