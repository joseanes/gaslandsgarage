import type { V3Upgrade } from './types';

function u(partial: Omit<V3Upgrade, 'type' | 'buildSlots'>): V3Upgrade {
	return { type: 'upgrade', buildSlots: partial.slots, ...partial };
}

export const v3Upgrades: V3Upgrade[] = [
	u({ id: 'big_tyres', name: 'Big Tyres', category: 'common', cost: 1, slots: 0, specialRules: 'Treacherous', effect: 'Ignore treacherous surfaces.' }),
	u({ id: 'bull_bar', name: 'Bull Bar', category: 'common', cost: 1, slots: 0, needsFacing: true, specialRules: 'Facing', effect: 'Pick a facing. Smashes on that side gain a die and give the target a hazard.' }),
	u({ id: 'buzzblades', name: 'Buzzblades', category: 'common', cost: 3, slots: 0, needsFacing: true, specialRules: 'Facing, Ignores Armour 2', effect: 'Pick a facing. Smashes on that side ignore the first two armour results.' }),
	u({ id: 'cb_radio', name: 'CB Radio', category: 'common', cost: 1, slots: 0, specialRules: '', effect: 'Giving way does not cost a hazard.' }),
	u({ id: 'extra_armour', name: 'Extra Armour', category: 'common', cost: 3, slots: 1, armour: 1, specialRules: '+1 Armour', effect: 'Armour increases by 1.' }),
	u({ id: 'extra_crewmember', name: 'Extra Crewmember', category: 'common', cost: 2, slots: 0, crew: 1, specialRules: '+1 Crew', effect: 'Crew increases by 1.' }),
	u({ id: 'heavy_frame', name: 'Heavy Frame', category: 'common', cost: 1, slots: 1, weight: 1, specialRules: '+1 Weight', effect: 'Weight increases by 1.' }),
	u({ id: 'infuriating_jingle', name: 'Infuriating Jingle', category: 'common', cost: 2, slots: 0, electrical: true, specialRules: 'Electrical', effect: 'An enemy in medium who can shoot you must shoot you.' }),
	u({ id: 'magnetic_jammer', name: 'Magnetic Jammer', category: 'common', cost: 2, slots: 0, electrical: true, specialRules: 'Electrical', effect: 'When an enemy in medium spends ammo, they take a damage on a 4+.' }),
	u({ id: 'nitro_booster', name: 'Nitro Booster', category: 'common', cost: 3, slots: 0, specialRules: 'Ammo 1', effect: 'Once an activation, take 3 hazards to link a medium straight, long straight, or long 30.' }),
	u({ id: 'ram', name: 'Ram', category: 'common', cost: 2, slots: 1, needsFacing: true, specialRules: 'Facing', effect: 'Pick a facing. Collisions on that side roll +2 smash dice and ignore the first hazard.' }),
	u({ id: 'ramshackle_hull_plating', name: 'Ramshackle Hull Plating', category: 'common', cost: 1, slots: 1, hull: 2, specialRules: '+2 Hull', effect: 'Hull increases by 2.' }),
	u({ id: 'roll_cage', name: 'Roll Cage', category: 'common', cost: 2, slots: 1, specialRules: '', effect: 'Ignore crunch damage when you wipe out.' }),
	u({ id: 'siren', name: 'Siren', category: 'common', cost: 2, slots: 0, specialRules: '', effect: 'After attacking, roll under an enemy’s gear in medium to make them drop a gear or take 2 hazards.' }),
	u({ id: 'spikes', name: 'Spikes', category: 'common', cost: 2, slots: 0, specialRules: '', effect: 'Anyone who smashes you takes 1 damage.' }),
	u({ id: 'tank_tracks', name: 'Tank Tracks', category: 'common', cost: 3, slots: 1, gear: -1, handling: 1, specialRules: '-1 Gear, +1 Handling', effect: 'Handling +1, max gear −1, ignore treacherous surfaces.' }),
	u({ id: 'trailer_lightweight', name: 'Trailer (Lightweight)', category: 'common', cost: 2, slots: 0, isTrailer: true, bonusSlots: 1, specialRules: '+1 slot, Articulated', effect: 'Adds 1 build slot and the articulated rule. Only one trailer, and not on an airborne vehicle.' }),
	u({ id: 'trailer_middleweight', name: 'Trailer (Middleweight)', category: 'common', cost: 4, slots: 0, isTrailer: true, bonusSlots: 2, minWeight: 2, specialRules: '+2 slots, Articulated, Hefty', effect: 'Weight 2+ only. Adds 2 build slots plus articulated and hefty.' }),
	u({ id: 'trailer_heavyweight', name: 'Trailer (Heavyweight)', category: 'common', cost: 6, slots: 0, isTrailer: true, bonusSlots: 3, minWeight: 4, specialRules: '+3 slots, Articulated, Hefty, Sluggish', effect: 'Weight 4+ only. Adds 3 build slots plus articulated, hefty, and sluggish.' }),
	u({ id: 'v10_engine', name: 'V10 Engine', category: 'common', cost: 5, slots: 0, gear: 1, specialRules: '+1 Max Gear', effect: 'Max gear +1, but not above 6.' }),
	u({ id: 'wheel_scythes', name: 'Wheel Scythes', category: 'common', cost: 1, slots: 0, specialRules: 'Rattle', effect: 'Smash attacks also hand out hazards on criticals.' }),

	u({ id: 'experimental_nuclear_engine', name: 'Experimental Nuclear Engine', category: 'rare', cost: 5, slots: 1, electrical: true, specialRules: 'Ammo 1, Electrical', effect: 'Once a round, take 2 damage to declare a template as if you were in gear 6. If wrecked, you explode at double weight and do not respawn. Once per team.' }),
	u({ id: 'experimental_teleporter', name: 'Experimental Teleporter', category: 'rare', cost: 3, slots: 1, electrical: true, specialRules: 'Ammo 1, Electrical', effect: 'Try to blink onto a marker with a straight template. A miss lets the player on your left place you. Once per team.' }),
	u({ id: 'exploding_ram', name: 'Exploding Ram', category: 'rare', cost: 2, slots: 0, specialRules: 'Ammo 1', effect: 'Front collisions detonate for +6 smash dice and you take damage on 1s and 2s. Stacks with a ram. Once per team.' }),
	u({ id: 'grabber_arm', name: 'Grabber Arm', category: 'rare', cost: 1, slots: 2, specialRules: '', effect: 'Once an activation, when you would shunt, take a hazard to place the victim anywhere in short range. Once per team.' }),
	u({ id: 'improvised_sludge_thrower', name: 'Improvised Sludge Thrower', category: 'rare', cost: 1, slots: 2, specialRules: '', effect: 'Place your dropped-weapon templates anywhere in medium range, any facing. Once per team.' }),
	u({ id: 'magnetic_clamps', name: 'Magnetic Clamps', category: 'rare', cost: 2, slots: 0, specialRules: '', effect: 'You can only be shunted if the hit caused 3 or more damage. Once per team.' }),
	u({ id: 'rubber_bumpers', name: 'Rubber Bumpers', category: 'rare', cost: 2, slots: 0, specialRules: '', effect: 'You always shunt, unless they outweigh you by 2+ or they are hefty and heavier. Once per team.' }),
	u({ id: 'turret_mount', name: 'Turret Mount', category: 'rare', cost: 2, slots: 1, addsWeaponCost: true, specialRules: '360, 2+weapon', effect: 'One shooting weapon gains a full arc. Costs 2 cans plus that weapon’s cost. A tank pays no build slot. Once per team.' }),
	u({ id: 'wall_of_amplifiers', name: 'Wall Of Amplifiers', category: 'rare', cost: 3, slots: 3, specialRules: '', effect: 'At the end of movement, gather up to 1 hazard from each nearby friendly and pile them on one vehicle in medium. Once per team.' })
];
