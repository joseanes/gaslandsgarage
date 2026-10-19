import { describe, expect, it } from 'vitest';
import {
	filterOptions,
	firstEnabled,
	groupOptions,
	highlightParts,
	matchHint,
	moveActive,
	placeAddList,
	type AddOption
} from './addCombobox';
import { perkAddOptions, upgradeAddOptions, weaponAddOptions, type SlotContext } from '../builder/gearAddOptions';

const car: SlotContext = {
	rulesVersion: 2,
	vehicleType: { buildSlots: 2 },
	maxBuildSlots: 2,
	usedBuildSlots: 0,
	resolvedWeapons: [],
	resolvedUpgrades: [],
	capacity: null
};

const guns = weaponAddOptions(
	[
		{
			id: 'hmg',
			name: 'Heavy Machine Gun',
			cost: 3,
			slots: 1,
			range: 'Double',
			attackDice: 3,
			specialRules: ''
		},
		{
			id: 'mg',
			name: 'Machine Gun',
			cost: 2,
			slots: 1,
			range: 'Double',
			attackDice: 1
		},
		{
			id: 'tank_cannon',
			name: 'Tank Cannon',
			cost: 6,
			slots: 5,
			range: 'Double',
			attackDice: 6,
			specialRules: 'SPLASH'
		},
		{
			id: 'handgun',
			name: 'Handgun',
			cost: 0,
			slots: 0,
			range: 'Short',
			attackDice: 1,
			specialRules: 'CREW FIRED'
		}
	],
	car
);

describe('gear search', () => {
	it('matches names, aliases, and keywords without case', () => {
		expect(filterOptions(guns, 'machine').map((option) => option.name)).toEqual([
			'Heavy Machine Gun',
			'Machine Gun'
		]);
		expect(filterOptions(guns, 'MG').map((option) => option.id)).toContain('mg');
		expect(filterOptions(guns, 'hmg').map((option) => option.id)).toEqual(['hmg']);
		expect(filterOptions(guns, 'splash').map((option) => option.id)).toEqual(['tank_cannon']);
		expect(filterOptions(guns, 'crew').map((option) => option.id)).toEqual(['handgun']);
	});

	it('highlights the matched letters and shows an alias when the name does not contain it', () => {
		expect(highlightParts('Heavy Machine Gun', 'machine')).toEqual([
			{ text: 'Heavy ', match: false },
			{ text: 'Machine', match: true },
			{ text: ' Gun', match: false }
		]);
		const machineGun = guns.find((option) => option.id === 'mg') as AddOption;
		expect(matchHint(machineGun, 'mg')).toBe('mg');
		expect(highlightParts('Heavy Machine Gun', 'machine').some((part) => part.match)).toBe(true);
	});

	it('keeps a weapon the car cannot fit, disabled, with the slot reason', () => {
		const tank = guns.find((option) => option.id === 'tank_cannon') as AddOption;
		expect(tank.disabled).toBe(true);
		expect(tank.reason).toBe('Insufficient slots');
		expect(tank.facts.map((fact) => fact.text)).toEqual(['Double', '🎲 6', '5 slots', '6 cans']);
		expect(filterOptions(guns, 'tank')).toEqual([tank]);

		const full = weaponAddOptions(
			[
				{ id: 'mg', name: 'Machine Gun', cost: 2, slots: 1, range: 'Double', attackDice: 1 },
				{ id: 'handgun', name: 'Handgun', cost: 0, slots: 0, range: 'Short', attackDice: 1 }
			],
			{ ...car, usedBuildSlots: 2 }
		);
		expect(full.find((option) => option.id === 'mg')?.disabled).toBe(true);
		expect(full.find((option) => option.id === 'handgun')?.disabled).toBe(false);
	});

	it('pins the 3rd edition machine gun, then sorts the rest', () => {
		const options = weaponAddOptions(
			[
				{ id: 'heavy_machine_gun', name: 'Heavy Machine Gun', cost: 2, slots: 1, range: 'Double', attackDice: 4, keywords: ['shooting'] },
				{ id: 'machine_gun', name: 'Machine Gun', cost: 1, slots: 1, range: 'Double', attackDice: 3, keywords: ['shooting'] },
				{ id: 'handgun', name: 'Handgun', cost: 0, slots: 0, range: 'Medium', attackDice: 1 }
			],
			{ ...car, rulesVersion: 3, capacity: 2 }
		);
		expect(options.map((option) => option.id)).toEqual(['machine_gun', 'handgun', 'heavy_machine_gun']);
		expect(options[0].id).toBe('machine_gun');
		expect(options.slice(1).map((option) => option.name)).toEqual(['Handgun', 'Heavy Machine Gun']);
		expect(filterOptions(options, 'mg').map((option) => option.id)).toContain('machine_gun');
		expect(filterOptions(options, 'hmg').map((option) => option.id)).toEqual(['heavy_machine_gun']);
	});

	it('does not group a flat menu, and does group when a group is already set', () => {
		expect(groupOptions(guns).map((group) => group.label)).toEqual([null]);
		const grouped = groupOptions([
			{ ...guns[0], group: 'Dropped' },
			{ ...guns[1], group: 'Dropped' },
			{ ...guns[2], group: 'Shooting' }
		]);
		expect(grouped.map((group) => group.label)).toEqual(['Dropped', 'Shooting']);
	});

	it('skips disabled rows with the arrow keys', () => {
		const rows = [
			{ ...guns[0], disabled: true },
			guns[1],
			{ ...guns[2], disabled: true }
		];
		expect(moveActive(rows, -1, 1)).toBe(1);
		expect(moveActive(rows, 1, 1)).toBe(1);
		expect(moveActive(rows, 1, -1)).toBe(1);
		expect(firstEnabled(rows.filter((row) => row.disabled))).toBe(-1);
	});

	it('sorts perks and upgrades by name and marks an upgrade that does not fit', () => {
		const perks = perkAddOptions([
			{ id: 'powder_keg', name: 'Powder Keg', cost: 1, class: 'aggression' },
			{ id: 'battle', name: 'Battlehammer', cost: 2, class: 'aggression' }
		]);
		expect(perks.map((option) => option.name)).toEqual(['Battlehammer', 'Powder Keg']);
		expect(filterOptions(perks, 'aggression').map((option) => option.id)).toEqual(['battle', 'powder_keg']);

		const upgrades = upgradeAddOptions(
			[
				{ id: 'ram', name: 'Ram', cost: 4, slots: 1 },
				{ id: 'tank_tracks', name: 'Tank Tracks', cost: 4, slots: 3 }
			],
			car
		);
		expect(upgrades.find((option) => option.id === 'tank_tracks')?.reason).toBe('Insufficient slots');
		expect(upgrades.find((option) => option.id === 'ram')?.disabled).toBe(false);
	});
});

describe('list placement', () => {
	const anchor = { top: 500, bottom: 540, left: 40, width: 280 };

	it('opens below the input when there is room', () => {
		const place = placeAddList(anchor, { top: 0, left: 0, width: 1280, height: 900, keyboard: false });
		expect(place.mode).toBe('below');
		expect(place.top).toBeGreaterThan(anchor.bottom);
	});

	it('opens upward when the input sits near the bottom', () => {
		const low = { top: 760, bottom: 800, left: 40, width: 280 };
		const place = placeAddList(low, { top: 0, left: 0, width: 1280, height: 840, keyboard: false });
		expect(place.mode).toBe('above');
		expect(place.top + place.maxHeight).toBeLessThanOrEqual(low.top);
	});

	it('uses a sheet inside the visible area when a phone keyboard leaves no room', () => {
		const field = { top: 80, bottom: 124, left: 16, width: 358 };
		const place = placeAddList(field, { top: 0, left: 0, width: 390, height: 280, keyboard: true });
		expect(place.mode).toBe('sheet');
		expect(place.top).toBeGreaterThanOrEqual(field.bottom);
		expect(place.top + place.maxHeight).toBeLessThanOrEqual(280);
		expect(place.left).toBeGreaterThanOrEqual(0);
		expect(place.left + place.width).toBeLessThanOrEqual(390);
	});
});
