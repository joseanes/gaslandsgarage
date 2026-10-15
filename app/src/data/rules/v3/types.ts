/** Structured 3rd Edition builder data. Ability text is paraphrased, not copied from the book. */

export interface V3Vehicle {
	id: string;
	name: string;
	rarity: 'common' | 'rare';
	maxGear: number;
	handling: number;
	crew: number;
	weight: number;
	armour: number;
	maxHull: number;
	buildSlots: number;
	baseCost: number;
	specialRules: string;
	/** Van may buy electrical gear and cheapen up to three upgrades by one slot. */
	utility?: boolean;
	/** Tank's turret mount costs no build slots. */
	turretFree?: boolean;
	/** Cannot take a trailer. */
	airborne?: boolean;
	/** First one does not count toward team-size or rare-type limits. */
	mob?: boolean;
}

export interface V3Weapon {
	id: string;
	name: string;
	type: 'weapon';
	category: 'common' | 'hand' | 'dropped' | 'rare';
	cost: number;
	slots: number;
	buildSlots: number;
	range: string;
	attackDice: number | string;
	specialRules: string;
	effect: string;
	keywords: string[];
	electrical?: boolean;
	/** facing = choose front/side/rear; 360 and dropped do not. */
	arc: 'facing' | '360' | 'dropped';
	/** Counts toward the Rutherford shooting-weapon requirement. */
	countsAsShooting?: boolean;
	ammo?: number;
}

export interface V3Upgrade {
	id: string;
	name: string;
	type: 'upgrade';
	category: 'common' | 'rare';
	cost: number;
	slots: number;
	buildSlots: number;
	specialRules: string;
	effect: string;
	electrical?: boolean;
	needsFacing?: boolean;
	isTrailer?: boolean;
	bonusSlots?: number;
	minWeight?: number;
	hull?: number;
	gear?: number;
	handling?: number;
	crew?: number;
	weight?: number;
	armour?: number;
	/** Turret mount price is 2 plus the chosen weapon's cost. */
	addsWeaponCost?: boolean;
}

export interface V3Perk {
	id: string;
	name: string;
	class: string;
	cost: number;
	/** Same number as cost so existing can totals that read `level` stay aligned. */
	level: number;
	text: string;
	sponsor: string;
	crew?: number;
}

export interface V3Driver {
	id: string;
	name: string;
	perkClass: string;
	ability: string;
	/** Spark lets the whole team buy electrical gear. */
	unlocksElectrical?: boolean;
}

export interface V3Sponsor {
	id: string;
	name: string;
	color: string;
	requirement: string;
	perkName: string;
	perkText: string;
	perks: string[];
	perksClasses: string[];
}

export interface V3VehicleRule {
	id: string;
	ruleName: string;
	rule: string;
}

export interface V3Catalog {
	sponsors: V3Sponsor[];
	vehicleTypes: V3Vehicle[];
	weapons: V3Weapon[];
	upgrades: V3Upgrade[];
	perks: V3Perk[];
	vehicleRules: V3VehicleRule[];
	drivers: V3Driver[];
	perkClasses: { id: string; name: string }[];
}
