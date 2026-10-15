import type { V3Driver } from './types';

export const v3PerkClasses: { id: string; name: string }[] = [
	{ id: 'aggression', name: 'Aggression' },
	{ id: 'badass', name: 'Badass' },
	{ id: 'daring', name: 'Daring' },
	{ id: 'fireworks', name: 'Fireworks' },
	{ id: 'military', name: 'Military' },
	{ id: 'mischief', name: 'Mischief' },
	{ id: 'precision', name: 'Precision' },
	{ id: 'pursuit', name: 'Pursuit' },
	{ id: 'pyromania', name: 'Pyromania' },
	{ id: 'reckless', name: 'Reckless' },
	{ id: 'rowdy', name: 'Rowdy' },
	{ id: 'speed', name: 'Speed' },
	{ id: 'tech', name: 'Tech' },
	{ id: 'wrench', name: 'Wrench' }
];

export const v3Drivers: V3Driver[] = [
	{ id: 'arsonist', name: 'Arsonist', perkClass: 'pyromania', ability: 'Drops hazards when on fire, when lighting someone up, or when shooting a burning target.' },
	{ id: 'blackfinger', name: 'Blackfinger', perkClass: 'wrench', ability: 'Once an activation, spend 2 Focus during handling to repair 2 hull.' },
	{ id: 'brawler', name: 'Brawler', perkClass: 'aggression', ability: 'A smash of 8 or more dice lets you discard 2 hazards.' },
	{ id: 'gremlin', name: 'Gremlin', perkClass: 'mischief', ability: 'Force a re-roll of a wipeout or explosion check within long range.' },
	{ id: 'gun_nut', name: 'Gun Nut', perkClass: 'fireworks', ability: 'Once a round, take 1 damage to fire an ammo weapon again, ignoring the crew cap.' },
	{ id: 'hauler', name: 'Hauler', perkClass: 'wrench', ability: 'If you start an attack roll on 2+ hull, that roll cannot wreck you down to 0.' },
	{ id: 'hunter', name: 'Hunter', perkClass: 'pursuit', ability: 'Re-roll attack dice against a target that has already activated this round.' },
	{ id: 'mystic', name: 'Mystic', perkClass: 'mischief', ability: 'Keep a sacred die and swap it with one of your later rolls.' },
	{ id: 'professional', name: 'Professional', perkClass: 'precision', ability: 'Once a round, take a hazard to flip one handling die between Focus and Fury.' },
	{ id: 'psycho', name: 'Psycho', perkClass: 'reckless', ability: 'Once a round, hand one of your hazards to a vehicle in medium range.' },
	{ id: 'raider', name: 'Raider', perkClass: 'rowdy', ability: 'Ignore the Distracted rule.' },
	{ id: 'road_warrior', name: 'Road Warrior', perkClass: 'badass', ability: 'The first time you damage each enemy in a round, discard a hazard.' },
	{ id: 'rough_rider', name: 'Rough Rider', perkClass: 'daring', ability: 'After hitting an obstacle, pivot up to 90 degrees if you end clear.' },
	{ id: 'spark', name: 'Spark', perkClass: 'tech', unlocksElectrical: true, ability: 'Spend a hazard on a shot to stretch medium to long, or to add Fire, Blast, or Indirect. The whole team may buy electrical gear.' },
	{ id: 'speed_demon', name: 'Speed Demon', perkClass: 'speed', ability: 'At the start of activation, gain a hazard in gear 1–2, or discard 3 hazards in gear 6.' },
	{ id: 'stunt_driver', name: 'Stunt Driver', perkClass: 'daring', ability: 'Once during movement, take 2 hazards to ignore one obstacle or vehicle.' },
	{ id: 'warlord', name: 'Warlord', perkClass: 'military', ability: 'Once a round, a friendly vehicle in long range may take 2 hazards to shoot as if it were their attack step.' }
];
