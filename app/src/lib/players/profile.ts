import { customAlphabet } from 'nanoid';
import { assessLocation } from './location';

const ENTRY_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const createEntryId = customAlphabet(ENTRY_ALPHABET, 21);
const ENTRY_ID = /^[A-Za-z0-9]{20,40}$/;

export const LIMITS = {
	playerName: 60,
	bio: 280,
	locationLabel: 80,
	playSpots: 280,
	message: 500
} as const;

export type PlayerForm = {
	playerName: string;
	bio: string;
	locationLabel: string;
	playSpots: string;
	showOnMap: boolean;
	anonymousOnMap: boolean;
	openToGames: boolean;
};

export type StoredProfile = PlayerForm & {
	latE2: number | null;
	lngE2: number | null;
	mapEntryId: string;
	updatedAt: string;
};

export type MapWrite =
	| {
			anonymous: true;
			latE2: number;
			lngE2: number;
			updatedAt: string;
	  }
	| {
			anonymous: false;
			playerName: string;
			bio: string;
			playSpots: string;
			locationLabel: string;
			latE2: number;
			lngE2: number;
			openToGames: boolean;
			updatedAt: string;
	  };

export type OpenToGamesWrite = {
	playerName: string;
	bio: string;
	playSpots: string;
	updatedAt: string;
};

export type PresencePlan = {
	profile: StoredProfile;
	map: { entryId: string; entry: MapWrite } | null;
	removeMapEntryId: string | null;
	openToGames: OpenToGamesWrite | null;
	removeOpenToGames: boolean;
};

export type MapMarker = {
	id: string;
	anonymous: boolean;
	lat: number;
	lng: number;
	playerName: string;
	bio: string;
	playSpots: string;
	locationLabel: string;
	openToGames: boolean;
};

export function emptyForm(): PlayerForm {
	return {
		playerName: '',
		bio: '',
		locationLabel: '',
		playSpots: '',
		showOnMap: false,
		anonymousOnMap: false,
		openToGames: false
	};
}

export function normalizeForm(form: PlayerForm): PlayerForm {
	const location = assessLocation(form.locationLabel);
	return {
		playerName: form.playerName.trim(),
		bio: form.bio.trim(),
		locationLabel: location.ok ? location.label : form.locationLabel.trim(),
		playSpots: form.playSpots.trim(),
		showOnMap: form.showOnMap,
		anonymousOnMap: form.showOnMap ? form.anonymousOnMap : false,
		openToGames: form.openToGames
	};
}

function tooLong(value: string, max: number, label: string): string | null {
	if (value.length > max) return `${label} must be ${max} characters or fewer.`;
	return null;
}

function containsEmail(value: string): boolean {
	return value.includes('@');
}

export function validateForm(form: PlayerForm): string | null {
	const lengthError =
		tooLong(form.playerName, LIMITS.playerName, 'Player name') ||
		tooLong(form.bio, LIMITS.bio, 'Bio') ||
		tooLong(form.locationLabel, LIMITS.locationLabel, 'Location') ||
		tooLong(form.playSpots, LIMITS.playSpots, 'Where you play');
	if (lengthError) return lengthError;
	if ([form.playerName, form.bio, form.locationLabel, form.playSpots].some(containsEmail)) {
		return 'Leave email addresses off your profile. Game requests stay inside the app.';
	}
	const location = assessLocation(form.locationLabel);
	if (!location.ok) return location.error;
	if (form.showOnMap && !form.anonymousOnMap && !form.playerName) {
		return 'Add a player name, or choose to appear on the map as anonymous.';
	}
	if (form.openToGames && !form.playerName) {
		return 'Add a player name before turning on open to games. Your email is not shared.';
	}
	return null;
}

export function planPresence(input: {
	uid: string;
	form: PlayerForm;
	previous: StoredProfile | null;
	coords: { locationLabel: string; latE2: number | null; lngE2: number | null };
	now: string;
	createId?: () => string;
}): { ok: true; plan: PresencePlan } | { ok: false; error: string } {
	const form = normalizeForm(input.form);
	const invalid = validateForm(form);
	if (invalid) return { ok: false, error: invalid };
	if (form.showOnMap && (input.coords.latE2 == null || input.coords.lngE2 == null)) {
		return { ok: false, error: 'Add a city, region, or ZIP before appearing on the map.' };
	}

	let mapEntryId = input.previous?.mapEntryId ?? '';
	if (form.showOnMap && !mapEntryId) {
		mapEntryId = (input.createId ?? createEntryId)();
	}
	if (form.showOnMap && (mapEntryId === input.uid || !ENTRY_ID.test(mapEntryId))) {
		return { ok: false, error: 'Could not prepare a private map pin. Try saving again.' };
	}

	const profile: StoredProfile = {
		...form,
		locationLabel: input.coords.locationLabel,
		latE2: input.coords.latE2,
		lngE2: input.coords.lngE2,
		mapEntryId,
		updatedAt: input.now
	};

	let map: PresencePlan['map'] = null;
	if (form.showOnMap && input.coords.latE2 != null && input.coords.lngE2 != null) {
		const pin = { latE2: input.coords.latE2, lngE2: input.coords.lngE2, updatedAt: input.now };
		map = {
			entryId: mapEntryId,
			entry: form.anonymousOnMap
				? { anonymous: true, ...pin }
				: {
						anonymous: false,
						playerName: form.playerName,
						bio: form.bio,
						playSpots: form.playSpots,
						locationLabel: input.coords.locationLabel,
						openToGames: form.openToGames,
						...pin
					}
		};
	}

	const openToGames: OpenToGamesWrite | null = form.openToGames
		? {
				playerName: form.playerName,
				bio: form.bio,
				playSpots: form.playSpots,
				updatedAt: input.now
			}
		: null;

	return {
		ok: true,
		plan: {
			profile,
			map,
			removeMapEntryId: !form.showOnMap && input.previous?.showOnMap ? input.previous.mapEntryId : null,
			openToGames,
			removeOpenToGames: !form.openToGames && !!input.previous?.openToGames
		}
	};
}

export function readStoredProfile(data: Record<string, unknown> | undefined): StoredProfile | null {
	if (!data) return null;
	const text = (key: keyof PlayerForm) => (typeof data[key] === 'string' ? data[key] : '');
	const hundredth = (key: 'latE2' | 'lngE2') =>
		typeof data[key] === 'number' && Number.isInteger(data[key]) ? (data[key] as number) : null;
	return {
		playerName: text('playerName'),
		bio: text('bio'),
		locationLabel: text('locationLabel'),
		playSpots: text('playSpots'),
		showOnMap: data.showOnMap === true,
		anonymousOnMap: data.anonymousOnMap === true,
		openToGames: data.openToGames === true,
		latE2: hundredth('latE2'),
		lngE2: hundredth('lngE2'),
		mapEntryId: typeof data.mapEntryId === 'string' ? data.mapEntryId : '',
		updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : ''
	};
}

export function presentMapMarker(id: string, data: Record<string, unknown>): MapMarker | null {
	const { latE2, lngE2 } = data;
	if (typeof latE2 !== 'number' || typeof lngE2 !== 'number') return null;
	if (!Number.isInteger(latE2) || !Number.isInteger(lngE2)) return null;
	const lat = latE2 / 100;
	const lng = lngE2 / 100;
	if (data.anonymous === true) {
		return {
			id,
			anonymous: true,
			lat,
			lng,
			playerName: '',
			bio: '',
			playSpots: '',
			locationLabel: '',
			openToGames: false
		};
	}
	const text = (key: string) => (typeof data[key] === 'string' ? (data[key] as string) : '');
	return {
		id,
		anonymous: false,
		lat,
		lng,
		playerName: text('playerName'),
		bio: text('bio'),
		playSpots: text('playSpots'),
		locationLabel: text('locationLabel'),
		openToGames: data.openToGames === true
	};
}

export function escapeText(value: string): string {
	return value.replace(/[&<>"']/g, (char) => {
		switch (char) {
			case '&':
				return '&amp;';
			case '<':
				return '&lt;';
			case '>':
				return '&gt;';
			case '"':
				return '&quot;';
			default:
				return '&#39;';
		}
	});
}

export function contactDocId(fromUid: string, toUid: string): string {
	return `${fromUid}_${toUid}`;
}

export function validateContact(input: { fromName: string; message: string }): string | null {
	const fromName = input.fromName.trim();
	const message = input.message.trim();
	if (!fromName) return 'Add a player name on your profile before sending a request. Your email stays private.';
	if (fromName.includes('@')) return 'Use a player name, not an email address.';
	if (fromName.length > LIMITS.playerName) return `Player name must be ${LIMITS.playerName} characters or fewer.`;
	if (!message) return 'Write a short note about the game.';
	if (message.length > LIMITS.message) return `Keep the note to ${LIMITS.message} characters.`;
	return null;
}
