import { describe, expect, it } from 'vitest';
import { vehicleStatsSnapshot } from './vehicleStats';

describe('vehicle stats snapshot', () => {
	it('copies the Refuelled build the builder shows', () => {
		const stats = vehicleStatsSnapshot(
			{
				id: 'veh123',
				type: 'performance_car',
				name: 'Red',
				weapons: ['mg'],
				upgrades: ['armour_plating'],
				perks: []
			},
			2
		);
		expect(stats).toMatchObject({
			type: 'Performance Car',
			name: 'Red',
			hull: 10,
			handling: 4,
			crew: 1,
			gear: 6,
			cans: 21,
			weapons: ['Machine Gun'],
			upgrades: ['Armour Plating'],
			slots: '2/2',
			weight: 'Middleweight'
		});
		expect(JSON.stringify(stats)).not.toMatch(/uid|email|@/i);
	});

	it('copies a 3rd Edition build, including the driver, and drops an email-shaped name', () => {
		const stats = vehicleStatsSnapshot(
			{
				id: 'veh123',
				type: 'buggy',
				name: 'ada@gmail.com',
				weapons: ['machine_gun'],
				upgrades: ['ramshackle_hull_plating'],
				perks: ['battlehammer'],
				driverArchetype: 'brawler',
				driverName: 'Brick'
			},
			3
		);
		expect(stats.type).toBe('Buggy');
		expect(stats.name).toBe('');
		expect(stats.hull).toBe(10);
		expect(stats.cans).toBe(13 + 1 + 1 + 6);
		expect(stats.weapons).toEqual(['Machine Gun']);
		expect(stats.upgrades).toEqual(['Ramshackle Hull Plating']);
		expect(stats.perks).toEqual(['Battlehammer']);
		expect(stats.driver).toBe('Brawler (Brick)');
		expect(stats.slots).toBe('2/2');
		expect(JSON.stringify(stats)).not.toContain('@');
	});

	it('still describes an unknown vehicle without inventing an account', () => {
		const stats = vehicleStatsSnapshot({ type: 'not_a_car', name: 'Ghost' }, 2);
		expect(stats.type).toBe('Not A Car');
		expect(stats.name).toBe('Ghost');
		expect(stats.cans).toBe(0);
		expect(stats.weapons).toEqual([]);
	});
});
