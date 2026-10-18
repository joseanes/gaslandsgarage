import { describe, expect, it } from 'vitest';
import { readLayoutSettings, settingsFromAccount } from './browserSettings';

function memory(values: Record<string, string>) {
	return {
		getItem(key: string) {
			return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
		}
	};
}

describe('readLayoutSettings', () => {
	it('uses defaults when the browser has no saved settings', () => {
		expect(readLayoutSettings(null)).toMatchObject({
			darkMode: false,
			printStyle: 'classic',
			hasRules: false,
			showEquipmentDescriptions: true
		});
	});

	it('reads the print and display values the settings screen writes', () => {
		const settings = readLayoutSettings(
			memory({
				printStyle: 'dashboard',
				user_show_equipment: '0',
				showPerkDescriptions: 'true',
				darkMode: 'true',
				hasRules: 'true',
				enableSponsorships: 'false',
				location: 'Austin, TX'
			})
		);
		expect(settings.printStyle).toBe('dashboard');
		expect(settings.showEquipmentDescriptions).toBe(false);
		expect(settings.showPerkDescriptions).toBe(true);
		expect(settings.darkMode).toBe(true);
		expect(settings.hasRules).toBe(true);
		expect(settings.enableSponsorships).toBe(false);
		expect(settings.location).toBe('Austin, TX');
	});
});

describe('settingsFromAccount', () => {
	it('keeps a saved off choice and leaves missing fields alone', () => {
		const current = readLayoutSettings(memory({ darkMode: 'true', printStyle: 'roster' }));
		const next = settingsFromAccount(current, { showTeamSummary: false, location: '' });
		expect(next.showTeamSummary).toBe(false);
		expect(next.darkMode).toBe(true);
		expect(next.printStyle).toBe('roster');
		expect(next.location).toBe('');
	});
});
