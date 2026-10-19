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
		paintingUrl: 'https://www.youtube.com/@rustpainter',
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

const PAINTS = ['#c2410c', '#b45309', '#9a3412', '#ea580c', '#7c2d12', '#d97706'];
const PLAYERS = ['Casey', 'Riley', 'Morgan', 'Jules', 'Avery'];
const TYPES = ['Performance Car', 'Truck', 'Buggy', 'Tank', 'Bike', 'War Rig'];
const FIRST = ['Dust', 'Scrap', 'Iron', 'Neon', 'Bone'];
const SECOND = ['Hauler', 'Widow', 'Howler', 'Saint', 'Mule'];
const WEAPONS = [
	['Heavy Machine Gun', 'Ram'],
	['Minigun'],
	['Flamethrower'],
	['Rockets'],
	['Harpoon'],
	['Bazooka']
];
const UPGRADES = [['Exploding Ram'], ['Armour Plating'], ['Nitro'], ['Roll Cage'], ['Extra Crewmember'], ['Turret']];
const WEIGHTS = ['Light', 'Middleweight', 'Heavy'];

function seededCarImage(title: string, paint: string): string {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><rect width="640" height="400" fill="#1c1917"/><rect x="40" y="168" width="560" height="110" rx="24" fill="${paint}"/><rect x="150" y="96" width="280" height="90" rx="18" fill="#fb923c"/><circle cx="160" cy="286" r="42" fill="#0c0a09"/><circle cx="480" cy="286" r="42" fill="#0c0a09"/><circle cx="160" cy="286" r="16" fill="#e7e5e4"/><circle cx="480" cy="286" r="16" fill="#e7e5e4"/><text x="320" y="232" text-anchor="middle" fill="#fff7ed" font-size="36" font-family="sans-serif">${title}</text></svg>`;
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** About 30 local cards so the Gallery grid, paging, and sorts can be previewed without Firestore. */
export function sampleGalleryDeck(): GalleryPhoto[] {
	return Array.from({ length: 30 }, (_, index) => {
		const hero = index === 29;
		const photoOnly = !hero && index % 5 === 4;
		const player = hero ? 'Casey' : PLAYERS[index % PLAYERS.length];
		const vehicleType = hero ? 'Performance Car' : TYPES[index % TYPES.length];
		const name = hero ? 'Rust Rocket' : `${FIRST[index % FIRST.length]} ${SECOND[index % SECOND.length]}`;
		const createdAt = new Date(Date.UTC(2026, 0, 1 + index, 15, 0, 0)).toISOString();
		const photo: GalleryPhoto = {
			photoId: hero ? SAMPLE_SHARE_ID : `cardseed${String(index + 1).padStart(2, '0')}`,
			displayName: player,
			vehicleType,
			teamName: hero ? 'Rust Runners' : `${player} Crew`,
			caption: hero ? 'Orange and loud' : `${name} in the dust`,
			createdAt,
			url: seededCarImage(hero ? 'Rust Rocket' : name, PAINTS[index % PAINTS.length]),
			paintingUrl: hero ? 'https://www.youtube.com/@rustpainter' : '',
			vehicleStats: null
		};
		if (!photoOnly) {
			photo.vehicleStats = {
				type: vehicleType,
				name,
				hull: 4 + (index % 8),
				handling: 1 + (index % 5),
				crew: 1 + (index % 3),
				gear: 1 + (index % 6),
				cans: hero ? 50 : 10 + index,
				weapons: WEAPONS[index % WEAPONS.length],
				upgrades: UPGRADES[index % UPGRADES.length],
				perks: [],
				slots: `${1 + (index % 3)}/${2 + (index % 4)}`,
				weight: WEIGHTS[index % WEIGHTS.length],
				armour: '',
				driver: player
			};
		}
		return photo;
	});
}

export function sampleGalleryPhoto(): GalleryPhoto {
	const hero = sampleGalleryDeck().find((photo) => photo.photoId === SAMPLE_SHARE_ID);
	if (!hero) throw new Error('The sample gallery card is missing.');
	return hero;
}
