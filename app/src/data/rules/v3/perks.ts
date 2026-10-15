import type { V3Perk } from './types';

type Row = [string, string, number, string, number?];

/** [class, name, cost, paraphrase, optional crew bonus] */
const rows: Row[] = [
	['aggression', 'Battlehammer', 6, 'Smash dice increase by 1 for every 2 hazards you hold.'],
	['aggression', 'Beatdown', 2, 'Once an activation, after you damage someone under half hull, heal 1.'],
	['aggression', 'Boarding Party', 5, 'Smash dice increase by your crew advantage, up to +3.'],
	['aggression', 'Hit & Run', 3, 'If you deal 3+ damage in one step, shift a gear for free.'],
	['aggression', 'Impetuous', 2, 'For pole position, take up to 3 hazards to count as that much faster.'],
	['aggression', 'Spiked Fist', 4, 'Once a collision, re-roll a smash die for every 2 hazards you hold.'],

	['badass', 'Cheap Sunglasses', 5, 'Smash dice increase by how many more hazards the target has, up to +5.'],
	['badass', 'Cruising', 3, 'When you drop your last hazard, shift a gear for free.'],
	['badass', 'Mister Fahrenheit', 2, 'Collisions cannot give you more than 2 hazards in one activation.'],
	['badass', 'Smooth Operator', 3, 'Spend 2 Focus or 2 Fury on a handling check to discard up to 3 hazards.'],
	['badass', 'Taking Care Of Business', 2, 'Passing a gate or scoring a point clears your hazards.'],
	['badass', 'White Knuckles', 3, 'Wipeout checks need one extra Fury result.'],

	['daring', 'Barrel Roll', 1, 'If you collided during movement, you may choose to wipe out.'],
	['daring', 'Dust Clouds', 4, 'Spend 2 Fury and take 2 hazards so you cannot be shot for the rest of the round.'],
	['daring', 'Evasive Maneuvers', 5, 'Once a round, when you are hit, take 3 hazards to shunt yourself out before the smash.'],
	['daring', 'Handbrake Artist', 6, 'A drift may finish at any angle as long as you touch the far end of the template.'],
	['daring', 'Lock In', 2, 'Below half hull, handling is +1.'],
	['daring', 'Slippery', 3, 'When evading, take hazards to cancel that many criticals.'],

	['fireworks', 'Fully Loaded', 4, 'A weapon with 3+ ammo left also crits on 5s.'],
	['fireworks', 'Get Off My Lawn', 4, 'Re-roll attack dice when firing a rattle or blast weapon.'],
	['fireworks', 'Hidden Ammo Caches', 2, 'Passing a gate or scoring a point restores one ammo box.'],
	['fireworks', 'High Explosives', 1, 'Your blasts reach medium range instead of short.'],
	['fireworks', 'TNT', 4, 'Blast triggers on every uncancelled hit, not only criticals.'],
	['fireworks', 'Well Stocked', 3, 'Each ammo weapon and upgrade starts with one extra box.'],

	['military', 'Bullet-time', 3, 'If you slide, one weapon counts as 360 for the rest of the round.'],
	['military', 'Drive By', 3, 'Leave movement templates down and shoot from their sides with side or 360 weapons.'],
	['military', 'Easy Target', 5, 'Shooting a gear 1–2 target lowers their armour by 1 for that attack.'],
	['military', 'Full Bore', 4, 'Inside short range, your attack dice also crit on 5s.'],
	['military', 'Headshot', 6, 'Against a slower target, each critical counts as two.'],
	['military', 'Squaddies', 4, 'Once a step, take 2 hazards to count as +3 crew for that step.'],

	['mischief', 'Backstab', 4, 'If your shot touches the target’s rear, you may re-roll attack dice.'],
	['mischief', 'Fix Your Brakes', 3, 'Once an activation, take 2 hazards to force a nearby hazardous template into a safe one.'],
	['mischief', 'Jammy', 5, 'Each miss against you may discard a hazard or ping the shooter, up to 5.'],
	['mischief', 'Loose Screws', 2, 'If a smash deals you 2+ damage, drop a free oil, smoke, or caltrop template.'],
	['mischief', 'Secret Modifications', 1, 'Once a game, double a rare weapon’s dice and add Blast when an enemy declares it.'],
	['mischief', 'Slasher', 4, 'Each smash hit you evade gives the attacker a hazard.'],

	['precision', 'Chrome-Whisperer', 4, 'Spend 2 Fury to drop up to 3 gears and discard that many hazards.'],
	['precision', 'Delicate Touch', 3, 'No template is hazardous for you, and sluggish does not apply.'],
	['precision', 'Doughnut', 3, 'In gear 1, take a hazard at the start of activation to pivot about a corner.'],
	['precision', 'Fenderkiss', 2, 'Collisions you are in roll 2 fewer smash dice for everyone involved.'],
	['precision', 'Purring', 5, 'With no hazards, gear changes, drifts, and boosts are free.'],
	['precision', 'Slip Away', 5, 'Once a round, after evading a rear or T-bone smash, forced-move when the active vehicle finishes.'],

	['pursuit', "Book 'Em", 3, 'If you damage someone who already has 6+ hazards, they must wipeout-check next window.'],
	['pursuit', 'Eat Your Ticket', 2, 'Smashes against gear 5+ targets gain 3 dice.'],
	['pursuit', 'On Your Tail', 5, 'Once a round, when a nearby enemy activates, forced-move after their movement.'],
	['pursuit', 'PIT', 6, 'A rear-half collision can become a PIT: hits drop their gear instead of dealing damage.'],
	['pursuit', 'Predatory Instincts', 2, 'You may give way twice in a round.'],
	['pursuit', "Sheriff's Badge", 3, 'Re-roll attack dice against someone who has already damaged a vehicle this round.'],

	['pyromania', 'Burning Man', 3, 'While on fire, armour is +1.'],
	['pyromania', 'Fire Walk With Me', 1, 'Fire damage is reduced by 3, to a minimum of 1.'],
	['pyromania', 'Flame Trails', 4, 'While on fire, leave your movement templates as napalm trails.'],
	['pyromania', 'Hot Stuff', 1, 'You start the game on fire, including after each respawn.'],
	['pyromania', 'Incendiary', 1, 'Your explosions and blasts also set targets on fire.'],
	['pyromania', 'Raging Inferno', 3, 'Nearby vehicles take 1 extra damage from fire.'],

	['reckless', 'Beerserker', 5, 'At 6+ hazards, armour is +1.'],
	['reckless', 'Cut Up', 3, 'Swerves and veers ignore vehicles, and each ignored vehicle takes a hazard.'],
	['reckless', 'Drive Angry', 1, 'Gain a hazard at the start of your activation.'],
	['reckless', 'Hog Wild', 2, 'When you wipe out, choose whether the flip ignores obstructions.'],
	['reckless', 'Live Fast', 3, 'While hazards outnumber hull, you may volunteer for a wipeout check.'],
	['reckless', 'Sourmash Jet Booster', 4, 'At the end of movement, if you have 6+ hazards, forced-move a long straight.'],

	['rowdy', 'Bring Your Friends', 4, 'Crew increases by 1.', 1],
	['rowdy', 'Distracting Behaviour', 3, 'Enemies in medium cannot roll more than 3 handling dice.'],
	['rowdy', 'Free Booze', 3, 'Enemies in medium cannot spend handling results to clear hazards.'],
	['rowdy', 'Keep Up!', 2, 'At the start of your attack step, slower vehicles in medium take a hazard.'],
	['rowdy', 'Party Harder', 3, 'Whenever a nearby vehicle gains hazards, it gains one more.'],
	['rowdy', 'Under The Table', 2, 'When someone wipes out or wrecks in medium, clear your hazards.'],

	['speed', 'Burn Rubber', 3, 'After declaring a template, take 2 hazards to link a short straight.'],
	['speed', 'Eager Beaver', 2, 'If you activate first, add a bonus Fury to the handling check.'],
	['speed', 'Floor It', 2, 'Once a round, take a hazard during movement to gain a gear.'],
	['speed', 'Hell For Leather', 2, 'Take 2 hazards to treat the long straight as legal in every gear this activation.'],
	['speed', 'Kiss My Asphalt', 4, 'Handling +1 in gear 5, and +2 in gear 6.'],
	['speed', 'Slipstream', 2, 'After hitting a rear edge, take 3 hazards to ignore the crash and shift up 0–2 gears.'],

	['tech', 'Afterburners', 4, 'If forced to wipeout-check, you may jump to max gear first.'],
	['tech', 'Automated Weapon Systems', 3, 'During the attack step, take up to 3 hazards to count as that much extra crew.'],
	['tech', 'Exclusive Patents', 2, 'When a distant enemy uses a rare or electrical item you also have, hand them a hazard.'],
	['tech', 'Overclock', 4, 'Once a game, take 3 damage to double the dice of a rare or electrical shot.'],
	['tech', 'Rocket Thrusters', 3, 'A forced long straight may be a long 30. A forced medium straight may be a medium bend.'],
	['tech', 'Satellite Navigation', 3, 'Store Focus results and later swap them onto any friendly handling roll.'],

	['wrench', 'Field Repairs', 3, 'On respawn, roll a die and regain that many hull, up to your starting value.'],
	['wrench', 'Grind Your Gears', 3, 'Once a round, turn incoming damage into double hazards, or hazards into damage.'],
	['wrench', 'Mobile Mechanic', 4, 'Once an activation, a friendly in medium (including you) heals 1 hull.'],
	['wrench', 'Pneumatic Ram', 2, 'When you respawn, face any direction.'],
	['wrench', 'Snatch', 3, 'Once a collision, after you damage someone, take up to 2 hazards to heal that much.'],
	['wrench', 'Splashback', 2, 'Once a step, when you lose hull, make a 1-die shot at everyone in medium.']
];

function slug(name: string): string {
	return name
		.toLowerCase()
		.replace(/['’]/g, '')
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_|_$/g, '');
}

export const v3Perks: V3Perk[] = rows.map(([klass, name, cost, text, crew]) => ({
	id: slug(name),
	name,
	class: klass,
	cost,
	level: cost,
	text,
	sponsor: '',
	...(crew ? { crew } : {})
}));
