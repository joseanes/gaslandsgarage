import type { V3Vehicle, V3VehicleRule } from './types';

export const v3Vehicles: V3Vehicle[] = [
	{ id: 'buggy', name: 'Buggy', rarity: 'common', maxGear: 4, handling: 5, crew: 2, weight: 1, armour: 0, maxHull: 8, buildSlots: 2, baseCost: 13, specialRules: 'Roll Cage' },
	{ id: 'hot_rod', name: 'Hot Rod', rarity: 'common', maxGear: 6, handling: 3, crew: 1, weight: 1, armour: 0, maxHull: 8, buildSlots: 2, baseCost: 12, specialRules: 'Redline' },
	{ id: 'monster_truck', name: 'Monster Truck', rarity: 'common', maxGear: 5, handling: 4, crew: 2, weight: 4, armour: 1, maxHull: 12, buildSlots: 2, baseCost: 20, specialRules: 'All Terrain, Up And Over' },
	{ id: 'muscle_car', name: 'Muscle Car', rarity: 'common', maxGear: 6, handling: 3, crew: 2, weight: 3, armour: 1, maxHull: 12, buildSlots: 3, baseCost: 18, specialRules: 'Redline' },
	{ id: 'passenger_car', name: 'Passenger Car', rarity: 'common', maxGear: 4, handling: 4, crew: 2, weight: 2, armour: 1, maxHull: 12, buildSlots: 3, baseCost: 15, specialRules: '' },
	{ id: 'pickup', name: 'Pickup', rarity: 'common', maxGear: 4, handling: 3, crew: 3, weight: 3, armour: 1, maxHull: 14, buildSlots: 4, baseCost: 16, specialRules: '' },
	{ id: 'sports_car', name: 'Sports Car', rarity: 'common', maxGear: 6, handling: 5, crew: 1, weight: 2, armour: 0, maxHull: 10, buildSlots: 2, baseCost: 20, specialRules: 'Downforce' },
	{ id: 'van', name: 'Van', rarity: 'common', maxGear: 3, handling: 3, crew: 4, weight: 4, armour: 1, maxHull: 14, buildSlots: 3, baseCost: 18, specialRules: 'Utility Vehicle', utility: true },
	{ id: 'bike', name: 'Bike', rarity: 'rare', maxGear: 6, handling: 5, crew: 1, weight: 1, armour: 0, maxHull: 6, buildSlots: 1, baseCost: 12, specialRules: 'Redline, Mob', mob: true },
	{ id: 'heavy_truck', name: 'Heavy Truck', rarity: 'rare', maxGear: 3, handling: 3, crew: 4, weight: 5, armour: 2, maxHull: 16, buildSlots: 6, baseCost: 28, specialRules: 'Sluggish' },
	{ id: 'bus', name: 'Bus', rarity: 'rare', maxGear: 3, handling: 3, crew: 8, weight: 5, armour: 2, maxHull: 16, buildSlots: 3, baseCost: 30, specialRules: 'Sluggish' },
	{ id: 'gyrocopter', name: 'Gyrocopter', rarity: 'rare', maxGear: 4, handling: 4, crew: 1, weight: 1, armour: 0, maxHull: 4, buildSlots: 2, baseCost: 15, specialRules: 'Airborne', airborne: true },
	{ id: 'helicopter', name: 'Helicopter', rarity: 'rare', maxGear: 4, handling: 4, crew: 3, weight: 3, armour: 1, maxHull: 8, buildSlots: 4, baseCost: 30, specialRules: 'Airborne', airborne: true },
	{ id: 'tank', name: 'Tank', rarity: 'rare', maxGear: 3, handling: 3, crew: 3, weight: 6, armour: 5, maxHull: 16, buildSlots: 5, baseCost: 36, specialRules: 'All Terrain, Hefty, Turret, Up And Over', turretFree: true },
	{ id: 'war_rig', name: 'War Rig', rarity: 'rare', maxGear: 3, handling: 3, crew: 6, weight: 6, armour: 4, maxHull: 20, buildSlots: 8, baseCost: 40, specialRules: 'Articulated, Hefty, Sluggish' }
];

export const v3VehicleRules: V3VehicleRule[] = [
	{ id: 'roll-cage', ruleName: 'Roll Cage', rule: 'Ignore the damage step that follows a wipeout.' },
	{ id: 'redline', ruleName: 'Redline', rule: 'Spend 1 Focus or 2 Fury and take a hazard to jump to gear 5 during a handling check.' },
	{ id: 'all-terrain', ruleName: 'All Terrain', rule: 'Treacherous surfaces do not affect this vehicle.' },
	{ id: 'up-and-over', ruleName: 'Up And Over', rule: 'While ploughing through, spend hazards to ignore that many vehicles or obstacles, and ignore Distracted for the rest of the activation.' },
	{ id: 'downforce', ruleName: 'Downforce', rule: 'Spend a hazard to declare a movement template as if you were one gear slower. Can be used more than once in an activation.' },
	{ id: 'utility-vehicle', ruleName: 'Utility Vehicle', rule: 'This van may buy electrical weapons and upgrades. Up to three of its upgrades cost one fewer build slot (minimum zero).' },
	{ id: 'mob', ruleName: 'Mob', rule: 'The first bike in the team does not count toward vehicle limits, deployment limits, or the one-of-each rare type limit.' },
	{ id: 'sluggish', ruleName: 'Sluggish', rule: 'Cannot choose a movement template that is hazardous in the current gear.' },
	{ id: 'airborne', ruleName: 'Airborne', rule: 'Ignores vehicles and terrain while moving, cannot collide or tow a trailer, and takes 2 extra crunch damage on a wipeout.' },
	{ id: 'hefty', ruleName: 'Hefty', rule: 'A lighter vehicle cannot shunt this one.' },
	{ id: 'turret', ruleName: 'Turret', rule: 'A turret mount fitted to this tank uses no build slots.' },
	{ id: 'articulated', ruleName: 'Articulated', rule: 'Tractor and trailer move as a hinged pair. Weapons are declared on the cab or the trailer. No slide or drift; leftover fury must anchor and drop a gear.' }
];
