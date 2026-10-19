import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { v3Perks } from '../src/data/rules/v3/perks';
import { v3Upgrades } from '../src/data/rules/v3/upgrades';
import { v3Vehicles } from '../src/data/rules/v3/vehicles';
import { v3Weapons } from '../src/data/rules/v3/weapons';

function encodeDraft(draft: unknown) {
	return Buffer.from(encodeURIComponent(JSON.stringify(draft)), 'utf8').toString('base64');
}

async function importBuild(page: Page, draft: unknown) {
	await page.goto('/builder');
	await page.getByRole('button', { name: 'Teams' }).click();
	await page.getByRole('button', { name: 'Import Build' }).click();
	await page.getByPlaceholder('Paste encoded draft here').fill(encodeDraft(draft));
	await page.getByRole('button', { name: 'Import', exact: true }).click();
}

function ids(entries: { id: string }[]) {
	return entries.map((entry) => entry.id);
}

function stuffedVehicle(type: string, weaponIds: string[], upgradeIds: string[], perkIds: string[]) {
	const weapons = weaponIds.flatMap((id) => [`${id}_a`, `${id}_a`]);
	return {
		id: type,
		type,
		name: `Case ${type} end`,
		weapons,
		weaponFacings: weapons.includes('tank_cannon_a') ? { tank_cannon_a: 'turret' } : {},
		upgrades: upgradeIds.flatMap((id) => [id, id]),
		perks: perkIds
	};
}

test('every vehicle type still draws when gear is past slot and can limits', async ({ page }) => {
	test.setTimeout(180_000);
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('dialog', (dialog) => dialog.accept());

	const v2Vehicles = JSON.parse(readFileSync(new URL('../src/data/rules/vehicles.json', import.meta.url), 'utf8')) as {
		id: string;
		buildSlots: number;
	}[];
	const v2Weapons = JSON.parse(readFileSync(new URL('../src/data/rules/weapons.json', import.meta.url), 'utf8')) as {
		id: string;
	}[];
	const v2Upgrades = JSON.parse(readFileSync(new URL('../src/data/rules/upgrades.json', import.meta.url), 'utf8')) as {
		id: string;
	}[];
	const v2Perks = JSON.parse(readFileSync(new URL('../src/data/rules/perks.json', import.meta.url), 'utf8')) as {
		id: string;
	}[];

	const editions = [
		{
			rulesVersion: 2,
			types: v2Vehicles,
			weapons: ids(v2Weapons),
			upgrades: ids(v2Upgrades),
			perks: ids(v2Perks)
		},
		{
			rulesVersion: 3,
			types: v3Vehicles,
			weapons: ids(v3Weapons),
			upgrades: ids(v3Upgrades),
			perks: ids(v3Perks)
		}
	];

	for (const edition of editions) {
		const vehicles = edition.types.map((type, index) =>
			stuffedVehicle(type.id, edition.weapons, edition.upgrades, index === 0 ? edition.perks : edition.perks.slice(0, 3))
		);
		await importBuild(page, {
			teamName: `Over limit v${edition.rulesVersion}`,
			sponsor: edition.rulesVersion === 2 ? 'rutherford' : 'no_sponsor',
			maxCans: 50,
			rulesVersion: edition.rulesVersion,
			vehicles
		});

		await expect(page.getByText('could not be drawn')).toHaveCount(0);
		await expect(page.getByTestId('vehicle-summary')).toHaveCount(vehicles.length);
		const limited = edition.types.filter((type) => type.buildSlots > 0).length;
		await expect(page.getByTestId('slot-warning')).toHaveCount(limited);

		for (let index = 0; index < vehicles.length; index += 1) {
			const collapsed = page.locator('.vehicle-card').filter({ hasText: vehicles[index].name });
			await collapsed.getByRole('button', { name: 'Expand vehicle' }).click();
			const card = page.locator('.vehicle-card').filter({ has: page.getByRole('button', { name: 'Collapse vehicle' }) });
			await expect(card.getByRole('textbox', { name: 'Vehicle Name' })).toHaveValue(vehicles[index].name);
			await expect(card.getByLabel('Weapon facing direction').first()).toBeVisible();
			await expect(page.getByText('could not be drawn')).toHaveCount(0);
			if (edition.types[index].buildSlots > 0) {
				await expect(card.getByTestId('slot-warning')).toBeVisible();
			} else {
				await expect(card.getByTestId('slot-warning')).toHaveCount(0);
			}
		}
	}

	expect(errors.filter((message) => /effect_update_depth_exceeded|could not be drawn/i.test(message))).toEqual([]);
});

test('a turret facing from the weapon list still draws', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('dialog', (dialog) => dialog.accept());
	await importBuild(page, {
		teamName: 'Turret',
		sponsor: 'rutherford',
		maxCans: 50,
		rulesVersion: 2,
		vehicles: [
			{
				id: 'heavy',
				type: 'heavy_truck',
				name: 'Gun Truck',
				weapons: [] as string[],
				upgrades: [] as string[],
				perks: [] as string[],
				weaponFacings: {}
			}
		]
	});

	await page.getByRole('button', { name: 'Expand vehicle' }).click();
	await page.locator('#add-weapon-heavy').selectOption('tank_cannon');
	const facing = page.getByLabel('Weapon facing direction');
	await expect(facing).toHaveValue('turret');
	await expect(page.getByText('could not be drawn')).toHaveCount(0);
	await facing.selectOption('front');
	await expect(facing).toHaveValue('front');
	expect(errors).toEqual([]);
});
