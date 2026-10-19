/**
 * Local preview data for the car page, embed, and gallery share buttons.
 * Production pages never import this. It is not a shared car.
 */

import type { GalleryPhoto } from '../services/photoShare';
import type { PublicCar } from './carPage';

export const SAMPLE_SHARE_ID = 'samplecar1';

const SAMPLE_IMAGE = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600" viewBox="0 0 960 600">
<rect width="960" height="600" fill="#44403c"/>
<rect x="70" y="250" width="820" height="150" rx="28" fill="#c2410c"/>
<rect x="210" y="150" width="430" height="130" rx="24" fill="#ea580c"/>
<circle cx="250" cy="410" r="58" fill="#1c1917"/>
<circle cx="700" cy="410" r="58" fill="#1c1917"/>
<circle cx="250" cy="410" r="24" fill="#d6d3d1"/>
<circle cx="700" cy="410" r="24" fill="#d6d3d1"/>
<text x="480" y="330" text-anchor="middle" fill="#fff7ed" font-size="54" font-family="sans-serif">Rust Rocket</text>
</svg>`)}`;

export function samplePublicCar(): PublicCar {
	return {
		shareId: SAMPLE_SHARE_ID,
		displayName: 'Casey',
		vehicleType: 'Performance Car',
		teamName: 'Rust Runners',
		caption: 'Orange and loud',
		imageUrl: SAMPLE_IMAGE,
		vehicleStats: {
			type: 'Performance Car',
			name: 'Rust Rocket',
			hull: 8,
			handling: 4,
			crew: 1,
			gear: 5,
			cans: 45,
			weapons: ['Heavy Machine Gun', 'Minigun'],
			upgrades: ['Ram', 'Exploding Ram'],
			perks: ['Slippery'],
			slots: '2',
			weight: 'Light',
			armour: '',
			driver: 'Casey'
		}
	};
}

export function sampleGalleryPhoto(): GalleryPhoto {
	const car = samplePublicCar();
	return {
		photoId: car.shareId,
		displayName: car.displayName,
		vehicleType: car.vehicleType,
		teamName: car.teamName,
		caption: car.caption,
		createdAt: '2026-10-19T00:00:00.000Z',
		url: car.imageUrl,
		vehicleStats: car.vehicleStats
	};
}
