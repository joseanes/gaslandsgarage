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

	it('prints roster stats from the vehicle, not placeholder defaults', () => {
		const html = generatePrintableHtml({
			teamName: 'Haulers & Co',
			totalCans: 40,
			maxCans: 50,
			sponsorName: 'Rutherford',
			vehicles: [
				{
					...vehicle,
					name: 'Long Haul',
					stats: { hull: 26, handling: 2, gear: 4, crew: 5, weight: 'Heavyweight' },
					upgradeObjects: [{ id: 'extra_crewmember', name: 'Extra Crewmember', crew: 1 }]
				}
			],
			printStyle: 'roster',
			rulesVersion: 2
		});
		expect(html).toContain('Handling</span> 2');
		expect(html).toContain('Max Gear</span> 4');
		expect(html).toContain('Crew</span> 6');
		expect(html).toContain('Hull</span> 26');
		expect(html).toContain('Heavyweight');
		expect(html).not.toContain('Weight</span> Medium');
		expect(html).not.toContain('class="page-break"');
		expect(html).toContain('Haulers &amp; Co');
	});

	it('uses version 3 weight numbers, rule paraphrases, and item effects', () => {
		const html = generatePrintableHtml({
			teamName: 'Idris',
			totalCans: 56,
			maxCans: 50,
			sponsorName: 'Idris',
			vehicles: [
				{
					...vehicle,
					name: 'Rig',
					type: 'war_rig',
					specialRules: 'Up And Over, Sluggish',
					stats: { hull: 20, handling: 3, gear: 3, crew: 6, weight: 6, armour: 4, buildSlots: 8 },
					vehicleType: { name: 'War Rig', maxHull: 20, handling: 3, maxGear: 3, crew: 6, weight: 6, armour: 4, buildSlots: 8 },
					weaponObjects: [
						{
							id: 'rockets_a1b2',
							name: 'Rockets',
							facing: 'side',
							specialRules: 'Ammo 3, Blast',
							effect: 'Three shots. Criticals blast and hand out hazards.',
							cost: 2
						}
					],
					vehicleRules: [
						{ id: 'up-and-over', ruleName: 'Up And Over', rule: 'While ploughing through, spend hazards to ignore obstacles.' },
						{ id: 'sluggish', ruleName: 'Sluggish', rule: 'Cannot choose a hazardous template.' }
					]
				}
			],
			weaponAndUpgradeSpecialRules: [
				{ id: 'ammo_3', ruleName: 'AMMO 3', rule: '<p>Audience Votes reload this weapon.</p>' }
			],
			printStyle: 'classic',
			rulesVersion: 3,
			showEquipmentDescriptions: true,
			showSpecialRules: true
		});
		expect(html).toContain('stat-value">6</span>');
		expect(html).not.toContain('Middleweight');
		expect(html).not.toContain('Ultraheavy');
		expect(html).toContain('While ploughing through');
		expect(html).not.toContain('Description not available');
		expect(html).toContain('Three shots. Criticals blast and hand out hazards.');
		expect(html).not.toContain('Audience Votes');
		expect(html).not.toContain('page-break-before: always');
	});

	it('keeps version 2 ammo text and a single printable column', () => {
		const html = generatePrintableHtml({
			teamName: 'Old Team',
			totalCans: 12,
			maxCans: 50,
			sponsorName: 'Rutherford',
			vehicles: [
				{
					...vehicle,
					stats: { hull: 10, handling: 3, gear: 5, crew: 2, weight: 'Middleweight' },
					weaponObjects: [
						{ id: 'rockets_a1b2', name: 'Rockets', facing: 'front', specialRules: 'AMMO 3', attackDice: 6, cost: 5 }
					]
				}
			],
			weaponAndUpgradeSpecialRules: [
				{ id: 'ammo_3', ruleName: 'AMMO 3', rule: '<p>Discard an Ammo Token before the attack.</p>' }
			],
			printStyle: 'classic',
			rulesVersion: 2,
			showEquipmentDescriptions: true,
			showSpecialRules: false
		});
		expect(html).toContain('Discard an Ammo Token');
		expect(html).toContain('<p>');
		expect(html).toContain('Middleweight');
		expect(html).toContain('.vehicle-cards');
		expect(html).not.toContain('minmax(300px');
	});

	it('does not let a team name, perk, or weapon close a tag', () => {
		const payload = '</title><img src=x onerror=alert(1)>';
		for (const printStyle of ['classic', 'dashboard', 'roster']) {
			const html = generatePrintableHtml({
				teamName: payload,
				totalCans: 1,
				maxCans: 50,
				sponsorName: payload,
				sponsor: { requirement: payload, perkName: payload, perkText: payload },
				vehicles: [{
					name: payload,
					perks: [payload],
					weapons: [payload],
					perkObjects: [{ name: payload, text: payload }],
					weaponObjects: [{ name: payload, specialRules: payload, effect: payload }]
				}],
				qrCode: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
				printStyle,
				rulesVersion: 2
			});
			expect(html).not.toContain('<img');
			expect(html).not.toContain('</title><');
			expect(html.toLowerCase()).not.toContain('<script');
			expect(html).toContain('&lt;/title&gt;');
			expect(html).toContain('&lt;img');
		}
	});
});
