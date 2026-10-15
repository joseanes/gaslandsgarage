import type { V3Sponsor } from './types';

const blank = { perks: [] as string[], perksClasses: [] as string[] };

export const v3Sponsors: V3Sponsor[] = [
	{ id: 'no_sponsor', name: 'No Sponsor', color: '#6b7280', requirement: 'Sponsors are optional.', perkName: '', perkText: '', ...blank },
	{ id: 'chivo', name: 'Chivo', color: '#db2777', requirement: 'Every vehicle costs at least 25 cans.', perkName: 'Lowrider', perkText: 'While you have no hazards, handling is +1.', ...blank },
	{ id: 'highway_patrol', name: 'Highway Patrol', color: '#2563eb', requirement: 'Every vehicle has a Siren.', perkName: 'Rear View Mirror', perkText: 'Once a round, if an enemy laid 3+ templates, take 2 hazards to make a forced move.', ...blank },
	{ id: 'idris', name: 'Idris', color: '#dc2626', requirement: 'Every vehicle has Max Gear 6.', perkName: 'Ludicrous Speed', perkText: 'Once a round, after activating in gear 6, suffer damage equal to your weight to activate again.', ...blank },
	{ id: 'jumbo', name: 'Jumbo', color: '#ca8a04', requirement: 'Every vehicle is weight 4 or more.', perkName: 'Goliath', perkText: 'A weight 4+ vehicle may split its movement and attack into two activations the same round.', ...blank },
	{ id: 'miyazaki', name: 'Miyazaki', color: '#7c3aed', requirement: 'Every vehicle has at least 2 purchased perks.', perkName: 'Powerslide', perkText: 'A slide may use any template except the long straight, still counting as a slide.', ...blank },
	{ id: 'mishkin', name: 'Mishkin', color: '#0891b2', requirement: 'Every vehicle has a rare or electrical weapon or upgrade.', perkName: 'Dynamo', perkText: 'After a boost or flip, restore one ammo box on an electrical weapon or upgrade.', ...blank },
	{ id: 'maxxine', name: 'Maxxine', color: '#be185d', requirement: 'Every vehicle is weight 3 or less.', perkName: 'Skiing', perkText: 'On a wipeout, skip the lose-control pivot. The collision window still happens.', ...blank },
	{ id: 'order_of_the_inferno', name: 'Order of the Inferno', color: '#ea580c', requirement: 'The team has at least 3 Pyromania perks and/or Fire weapons, combined.', perkName: 'Eternal Flame', perkText: 'Skip the roll to see if your fire goes out at the start of activation.', ...blank },
	{ id: 'rusty', name: 'Rusty', color: '#b45309', requirement: 'The team has at least 5 upgrades.', perkName: 'Drunk Driver', perkText: 'No straight templates. Wipeout checks start only at 8+ hazards.', ...blank },
	{ id: 'rutherford', name: 'Rutherford', color: '#16a34a', requirement: 'The team has at least 5 shooting weapons, not counting handguns.', perkName: 'Snap Shot', perkText: 'Once a round, at the end of an enemy attack step, take 2 hazards to shoot that active vehicle.', ...blank },
	{ id: 'scarlett', name: 'Scarlett', color: '#e11d48', requirement: 'Total crew is greater than total weight.', perkName: 'Lashed', perkText: 'When you could shunt, you may lash the target to your hull instead.', ...blank },
	{ id: 'slime', name: 'Slime', color: '#65a30d', requirement: 'Every vehicle has at least 1 upgrade.', perkName: 'Pinball', perkText: 'When you shunt someone, you may take a hazard to shunt yourself as well.', ...blank },
	{ id: 'verney', name: 'Verney', color: '#0f766e', requirement: 'Every vehicle has at least 2 different dropped weapons.', perkName: 'Pickle Button', perkText: 'While moving you may drop along the template, and you may still use a second drop in the attack step.', ...blank },
	{ id: 'warden', name: 'The Warden', color: '#44403c', requirement: 'Every vehicle has hull 10 or more.', perkName: 'Rigged', perkText: 'Damage from an explosion, smash, or blast makes you blast back at short range with dice equal to your weight.', ...blank },
	{ id: 'beverly', name: 'Beverly', color: '#6d28d9', requirement: 'Exactly one vehicle has hull 12 or more.', perkName: 'Vengeful Spirits', perkText: 'The toughest vehicle anchors. The others start off the table as ghost riders that pass through traffic, set enemies on fire, and can heal the anchor by carrying souls through it.', ...blank }
];
