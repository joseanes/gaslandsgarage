import { expect, test } from '@playwright/test';

function encodeDraft(draft: unknown) {
	return Buffer.from(encodeURIComponent(JSON.stringify(draft)), 'utf8').toString('base64');
}

const styles = ['classic', 'dashboard', 'roster'] as const;

const v2 = {
	sponsor: 'rutherford',
	teamName: "Rutherford's Extremely Long Sponsored Wasteland Racing Syndicate & Friends",
	maxCans: 50,
	rulesVersion: 2,
	vehicles: [
		{
			id: 'v2a',
			type: 'performance_car',
			name: "Scarlet Annie's Extremely Long Performance Special",
			weapons: ['mg_w1a2', 'hmg_w3b4', 'handgun_w5c6'],
			weaponFacings: { mg_w1a2: 'front', hmg_w3b4: 'side', handgun_w5c6: '360' },
			upgrades: ['armour_plating', 'ram', 'extra_crewmember'],
			perks: ['powder_keg', 'double_barreled', 'boarding_party']
		},
		{
			id: 'v2b',
			type: 'buggy',
			name: 'Buggy & The Rusty Bootleggers Wasteland Express',
			weapons: ['rockets_r1a2', 'flamethrower_f3b4'],
			weaponFacings: { rockets_r1a2: 'front', flamethrower_f3b4: 'left' },
			upgrades: ['extra_crewmember'],
			perks: ['battlehammer', 'terrifying_lunatic']
		},
		{
			id: 'v2c',
			type: 'war_rig',
			name: 'War Rig Whose Name Keeps Going Across The Whole Card Header',
			weapons: ['mg_m1a2', 'hmg_m3b4'],
			weaponFacings: { mg_m1a2: 'front', hmg_m3b4: 'rear' },
			upgrades: ['ram', 'extra_crewmember'],
			perks: ['powder_keg', 'road_warrior']
		}
	]
};

const v3 = {
	sponsor: 'idris',
	teamName: 'Idris Ludicrous Speed Team With A Header That Fills The Page',
	maxCans: 50,
	rulesVersion: 3,
	vehicles: [
		{
			id: 'v3a',
			type: 'sports_car',
			name: 'The Unreasonably Long-Named Scarlet Speedster of the Wasteland Circuit',
			weapons: ['machine_gun_a1b2', 'rockets_c3d4', 'flamethrower_e5f6'],
			weaponFacings: { machine_gun_a1b2: 'front', rockets_c3d4: 'side', flamethrower_e5f6: 'front' },
			upgrades: ['extra_armour', 'extra_crewmember', 'ram'],
			perks: ['battlehammer', 'cheap_sunglasses', 'evasive_maneuvers'],
			driverArchetype: 'spark',
			driverName: 'Zap Zaperson-the-Third',
			secondPerkClass: 'speed'
		},
		{
			id: 'v3b',
			type: 'monster_truck',
			name: 'All-Terrain Monster With An Ampersand & A Very Long Title',
			weapons: ['heavy_machine_gun_h1i2', 'mortar_j3k4'],
			weaponFacings: { heavy_machine_gun_h1i2: 'front', mortar_j3k4: 'rear' },
			upgrades: ['big_tyres', 'ramshackle_hull_plating'],
			perks: ['boarding_party', 'handbrake_artist'],
			driverArchetype: 'brawler',
			driverName: 'Brick'
		},
		{
			id: 'v3c',
			type: 'war_rig',
			name: 'Articulated War Rig of the Long-Haul Sponsors',
			weapons: ['machine_gun_m1n2', 'rockets_o3p4'],
			weaponFacings: { machine_gun_m1n2: 'left', rockets_o3p4: 'right' },
			upgrades: ['extra_armour', 'tank_tracks'],
			perks: ['field_repairs', 'mobile_mechanic'],
			driverArchetype: 'warlord',
			driverName: 'Captain Haul'
		}
	]
};

for (const style of styles) {
	test(`version 2 ${style} print lists every vehicle with its real stats`, async ({ page }) => {
		const text = await printTeam(page, v2, style);
		expect(text).toContain("Scarlet Annie's Extremely Long Performance Special");
		expect(text).toContain('Buggy & The Rusty Bootleggers Wasteland Express');
		expect(text).toContain('War Rig Whose Name Keeps Going Across The Whole Card Header');
		expect(text).toContain('Powder Keg');
		expect(text).toContain('Machine Gun');
		expect(text).toContain('Heavyweight');
		expect(text).toContain('Lightweight');
		expect(text).not.toContain('Build slots');
		expect(text).not.toContain('Description not available');
		expect(text).not.toMatch(/Weight\s+Medium/);
		expect(text).toContain('121 / 50');
	});

	test(`version 3 ${style} print keeps edition stats and skips Refuelled essays`, async ({ page }) => {
		const text = await printTeam(page, v3, style);
		expect(text).toContain('The Unreasonably Long-Named Scarlet Speedster of the Wasteland Circuit');
		expect(text).toContain('All-Terrain Monster With An Ampersand & A Very Long Title');
		expect(text).toContain('Articulated War Rig of the Long-Haul Sponsors');
		expect(text).toContain('Zap Zaperson-the-Third');
		expect(text).toContain('Machine Gun');
		expect(text.toLowerCase()).toContain('armour');
		expect(text.toLowerCase()).toContain('build slots');
		expect(text.toLowerCase()).toMatch(/weight\s+6/);
		expect(text).not.toContain('Middleweight');
		expect(text).not.toContain('Ultraheavy');
		expect(text).not.toContain('Description not available');
		expect(text).not.toContain('Audience Votes');
		expect(text).toContain('Up And Over');
		if (style !== 'roster') expect(text).toContain('While ploughing through');
		expect(text).toContain('143 / 50');
	});
}

async function printTeam(
	page: import('@playwright/test').Page,
	draft: { rulesVersion: number },
	style: (typeof styles)[number]
) {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('dialog', (dialog) => dialog.accept());
	await page.addInitScript((printStyle) => {
		localStorage.setItem('hasRules', 'true');
		localStorage.setItem('user_print_style', printStyle);
		localStorage.setItem('printStyle', printStyle);
		localStorage.setItem('user_show_equipment', 'true');
		localStorage.setItem('user_show_perks', 'true');
		localStorage.setItem('user_show_special_rules', 'true');
	}, style);

	await page.goto(`/builder?draft=${encodeURIComponent(encodeDraft(draft))}`);
	await expect(page.getByTestId('vehicle-summary').first()).toBeVisible();

	const popupPromise = page.waitForEvent('popup');
	await page.getByRole('button', { name: 'Teams' }).click();
	await page.getByRole('button', { name: 'Print Team' }).click();
	const popup = await popupPromise;
	popup.on('pageerror', (error) => errors.push(error.message));
	popup.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text());
	});
	await popup.waitForLoadState('domcontentloaded');
	await popup.emulateMedia({ media: 'print' });
	const text = await popup.locator('body').innerText();
	const pdf = await popup.pdf({ format: 'Letter', printBackground: true });
	expect(pdf.byteLength).toBeGreaterThan(2000);
	expect(errors, errors.join('\n')).toEqual([]);
	return text;
}
