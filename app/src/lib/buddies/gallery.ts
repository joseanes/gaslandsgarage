import { publicCarLabel } from './model';

export const GALLERY_BUDDY_OFFERS = ['hidden', 'sign-in', 'add', 'sent', 'buddies', 'accept', 'declined'] as const;
export type GalleryBuddyOfferName = (typeof GALLERY_BUDDY_OFFERS)[number];

export function galleryBuddyLabel(offer: string): string {
	switch (offer) {
		case 'sign-in':
			return 'Sign in to add as buddy';
		case 'add':
			return 'Add as buddy';
		case 'sent':
			return 'Request sent';
		case 'buddies':
			return 'Buddies ✓';
		case 'accept':
			return 'Accept buddy request';
		case 'declined':
			return 'Request declined';
		default:
			return '';
	}
}

/** Shown on the incoming request. The car name is the public card name. */
export function galleryBuddyContext(carName: string): string {
	return `found you through your painted car: ${publicCarLabel({ caption: carName })}`;
}
