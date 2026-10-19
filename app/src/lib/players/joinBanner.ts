import type { MapMarker, PlayerForm, StoredProfile } from './profile';

/**
 * "Not now" is remembered in localStorage, one key per signed-in account.
 * There is no profile field for this, so a dismissal does not write Firestore
 * and does not need a rules change. Clearing site data shows the banner again.
 */
export const JOIN_DISMISS_KEY = 'gaslands.playersMapJoin.dismissed';

export function joinDismissStorageKey(uid: string): string {
	return `${JOIN_DISMISS_KEY}.${uid}`;
}

type DismissStorage = {
	getItem?: (key: string) => string | null;
	setItem?: (key: string, value: string) => void;
};

export function isJoinDismissed(storage: DismissStorage | null | undefined, uid: string): boolean {
	if (!storage?.getItem || !uid) return false;
	try {
		return storage.getItem(joinDismissStorageKey(uid)) === '1';
	} catch {
		return false;
	}
}

export function dismissJoinBanner(storage: DismissStorage | null | undefined, uid: string): void {
	if (!storage?.setItem || !uid) return;
	try {
		storage.setItem(joinDismissStorageKey(uid), '1');
	} catch {
		// Private mode and blocked storage still hide the banner for this visit.
	}
}

export function shouldShowJoinBanner(input: {
	signedIn: boolean;
	showOnMap: boolean;
	dismissed: boolean;
}): boolean {
	return input.signedIn && !input.showOnMap && !input.dismissed;
}

export type JoinDraft = {
	playerName: string;
	locationLabel: string;
	showOnMap: boolean;
	anonymousOnMap: boolean;
	hasLocation: boolean;
};

/** Consent starts off every time the panel opens, even when a location is already saved. */
export function joinDraft(profile: StoredProfile | null): JoinDraft {
	const locationLabel = profile?.locationLabel ?? '';
	return {
		playerName: profile?.playerName ?? '',
		locationLabel,
		showOnMap: false,
		anonymousOnMap: false,
		hasLocation: locationLabel.trim() !== ''
	};
}

/** Keeps the rest of the profile so joining the map does not wipe bio, spots, or game requests. */
export function formForJoin(profile: StoredProfile | null, draft: JoinDraft): PlayerForm {
	return {
		playerName: draft.playerName,
		bio: profile?.bio ?? '',
		locationLabel: draft.locationLabel,
		playSpots: profile?.playSpots ?? '',
		showOnMap: draft.showOnMap,
		anonymousOnMap: draft.showOnMap ? draft.anonymousOnMap : false,
		openToGames: profile?.openToGames ?? false
	};
}

/** A pin the map can draw from a profile that was just saved, before the board is read again. */
export function markerFromJoinedProfile(profile: StoredProfile): MapMarker | null {
	if (!profile.showOnMap || profile.latE2 == null || profile.lngE2 == null || !profile.mapEntryId) return null;
	const point = { lat: profile.latE2 / 100, lng: profile.lngE2 / 100 };
	if (profile.anonymousOnMap) {
		return {
			id: profile.mapEntryId,
			anonymous: true,
			...point,
			playerName: '',
			bio: '',
			playSpots: '',
			locationLabel: '',
			openToGames: false
		};
	}
	return {
		id: profile.mapEntryId,
		anonymous: false,
		...point,
		playerName: profile.playerName,
		bio: profile.bio,
		playSpots: profile.playSpots,
		locationLabel: profile.locationLabel,
		openToGames: profile.openToGames
	};
}

export function withJoinedMarker(markers: MapMarker[], profile: StoredProfile): MapMarker[] {
	const pin = markerFromJoinedProfile(profile);
	if (!pin) return markers;
	return [...markers.filter((marker) => marker.id !== pin.id), pin];
}
