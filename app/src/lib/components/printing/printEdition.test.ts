import { describe, expect, it } from 'vitest';
import { generatePrintableHtml } from './PrintService';

const vehicle = {
	id: 'v1',
	name: 'Zap',
	type: 'sports_car',
	cost: 20,
	vehicleType: { name: 'Sports Car', maxHull: 10, handling: 5, maxGear: 6, crew: 1, weight: 2, armour: 0, buildSlots: 2 },
	stats: { hull: 10, handling: 5, gear: 6, crew: 1, weight: 2, armour: 0, buildSlots: 2 },
	driverSummary: 'Spark (Zap)',
	perkClassSummary: 'Tech, Speed',
	weaponObjects: [],
	upgradeObjects: [{ id: 'extra_armour', name: 'Extra Armour', armour: 1 }],
	perkObjects: []
};

describe('print sheets', () => {
	it('adds armour, build slots, driver, and sponsor notes on version 3', () => {
		const html = generatePrintableHtml({
			teamName: 'Share Check',
			totalCans: 20,
			maxCans: 50,
			sponsorName: 'Idris',
			sponsor: { id: 'idris', name: 'Idris', requirement: 'Every vehicle has Max Gear 6.', perkName: 'Ludicrous Speed', perkText: 'Activate again.' },
			vehicles: [vehicle],
			rulesVersion: 3
		});
		expect(html).toContain('Armour');
		expect(html).toContain('Build slots');
		expect(html).toContain('Spark (Zap)');
		expect(html).toContain('Tech, Speed');
		expect(html).toContain('Every vehicle has Max Gear 6.');
		expect(html).toContain('Ludicrous Speed');
	});

	it('leaves version 2 cards on the Refuelled stat line', () => {
		const html = generatePrintableHtml({
			teamName: 'Old Team',
			totalCans: 12,
			maxCans: 50,
			sponsorName: 'Rutherford',
			sponsor: { id: 'rutherford', name: 'Rutherford' },
			vehicles: [{ ...vehicle, name: 'Lead', upgradeObjects: [], driverSummary: 'Spark (Zap)', perkClassSummary: 'Tech' }],
			rulesVersion: 2
		});
		expect(html).toContain('Rutherford');
		expect(html).toContain('Handling');
		expect(html).not.toContain('stat-label">Armour');
		expect(html).not.toContain('Build slots');
		expect(html).not.toContain('Driver:');
		expect(html).not.toContain('Spark (Zap)');
		expect(html).not.toContain('Perk classes');
	});
});
