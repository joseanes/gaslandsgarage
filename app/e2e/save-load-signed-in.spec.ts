import { expect, test, type Locator, type Page } from '@playwright/test';
import { addGear } from './addGear';

function cansValue(page: Page) {
	return page.locator('b', { hasText: 'Cans:' }).locator('xpath=following-sibling::span[1]');
}

async function choose(page: Page, label: string, query: string, pattern: RegExp) {
	await addGear(page, label, query, pattern);
}

async function openTeams(page: Page) {
	await page.getByRole('button', { name: 'Teams', exact: true }).click();
	await page.getByRole('button', { name: 'Save/Load Team' }).click();
	const dialog = page.getByRole('dialog', { name: 'My Teams' });
	await expect(dialog).toBeVisible();
	return dialog;
}

async function saveNamedTeam(page: Page, dialog: Locator, name: string, notices: string[], success: string) {
	await expect(dialog.getByPlaceholder('Enter team name')).toHaveValue(name);
	const before = notices.length;
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect.poll(() => notices.slice(before).some((message) => message.includes(success))).toBeTruthy();
	await expect(dialog.getByText(name, { exact: true })).toBeVisible();
}

test('signed-out Save/Load and Quick Save ask the player to sign in', async ({ page }) => {
	await page.goto('/builder');
	await page.getByRole('button', { name: 'Quick Save' }).click();
	const prompt = page.getByRole('dialog', { name: 'Sign in to save' });
	await expect(prompt.getByText('Teams are stored on your Google account.')).toBeVisible();
	await prompt.getByRole('button', { name: 'Not now' }).click();
	await expect(prompt).toHaveCount(0);

	const dialog = await openTeams(page);
	await expect(dialog.getByText('Please sign in to save and load teams.')).toBeVisible();
	await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
});

test('a signed-in player can save, load, update, quick-save, and delete v2 and v3 teams', async ({ page }) => {
	test.setTimeout(120_000);
	const notices: string[] = [];
	page.on('dialog', async (dialog) => {
		notices.push(dialog.message());
		await dialog.accept();
	});

	const email = `saver-${Date.now()}@example.com`;
	await page.addInitScript(() => localStorage.setItem('gaslands-firebase-emulators', '1'));
	await page.goto('/builder', { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => typeof window.signInEmulatorUser === 'function');
	await page.evaluate(async (address) => {
		await window.signInEmulatorUser!(address, 'password123');
	}, email);
	await expect(page.getByRole('button', { name: email.split('@')[0] })).toBeVisible();

	await page.getByLabel('Team Name').fill('Refuelled Racers');
	await page.locator('#sponsor-select').selectOption('rutherford');
	await page.getByLabel('Maximum Cans').fill('60');
	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	await page.getByRole('button', { name: 'Expand vehicle' }).click();
	await page.getByLabel('Vehicle Name').fill('Hauler');
	await choose(page, 'Add a weapon', 'machine gun', /^Machine Gun\b/);
	await choose(page, 'Add an upgrade', 'ram', /^Ram\b/);
	await choose(page, 'Add a perk', 'powder', /^Powder Keg\b/);
	await expect(page.getByRole('listitem').filter({ hasText: 'Machine Gun' })).toBeVisible();
	await expect(page.getByRole('listitem').filter({ hasText: 'Ram' })).toBeVisible();
	await expect(page.getByRole('listitem').filter({ hasText: 'Powder Keg' })).toBeVisible();
	const v2Cans = await cansValue(page).innerText();

	let dialog = await openTeams(page);
	await saveNamedTeam(page, dialog, 'Refuelled Racers', notices, 'Team saved successfully');
	await dialog.getByRole('button', { name: 'Close teams modal' }).click();

	await page.locator('#rules-version').selectOption('3');
	await page.getByRole('dialog', { name: 'Switch rules version' }).getByRole('button', { name: 'Switch', exact: true }).click();
	await expect(page.locator('#rules-version')).toHaveValue('3');
	await expect(page.getByText('Your team has no vehicles yet')).toBeVisible();

	await page.getByLabel('Team Name').fill('Version Three Crew');
	await page.locator('#sponsor-select').selectOption('mishkin');
	await page.getByLabel('Maximum Cans').fill('45');
	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	await page.getByRole('button', { name: 'Expand vehicle' }).click();
	await page.getByLabel('Vehicle Name').fill('Zap');
	await page.getByRole('combobox', { name: 'Driver', exact: true }).selectOption('brawler', { force: true });
	await page.getByLabel('Driver name').fill('Brick');
	await choose(page, 'Add a weapon', 'machine gun', /^Machine Gun\b/);
	await choose(page, 'Add an upgrade', 'armour', /^Extra Armour\b/);
	await choose(page, 'Add a perk', 'battle', /^Battlehammer\b/);
	await expect(page.getByRole('listitem').filter({ hasText: 'Machine Gun' })).toBeVisible();
	await expect(page.getByRole('listitem').filter({ hasText: 'Extra Armour' })).toBeVisible();
	await expect(page.getByRole('listitem').filter({ hasText: 'Battlehammer' })).toBeVisible();
	const v3Cans = await cansValue(page).innerText();

	dialog = await openTeams(page);
	await saveNamedTeam(page, dialog, 'Version Three Crew', notices, 'Team saved successfully');
	await expect(dialog.getByText('Refuelled Racers', { exact: true })).toBeVisible();
	await expect(dialog.getByText('Version Three Crew', { exact: true })).toBeVisible();
	await dialog.getByRole('button', { name: 'Close teams modal' }).click();

	await page.reload({ waitUntil: 'domcontentloaded' });
	await expect(page.getByRole('button', { name: email.split('@')[0] })).toBeVisible();
	await expect(page.locator('#rules-version')).toHaveValue('3');

	dialog = await openTeams(page);
	await dialog.getByText('Version Three Crew', { exact: true }).locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]').getByRole('button', { name: 'Load' }).click();
	await expect(dialog).toHaveCount(0);
	await expect(page.locator('#rules-version')).toHaveValue('3');
	await expect(page.locator('#sponsor-select')).toHaveValue('mishkin');
	await expect(page.getByLabel('Team Name')).toHaveValue('Version Three Crew');
	await expect(page.getByLabel('Maximum Cans')).toHaveValue('45');
	await expect(cansValue(page)).toHaveText(v3Cans);
	await page.getByRole('button', { name: 'Expand vehicle' }).click();
	await expect(page.getByLabel('Vehicle Name')).toHaveValue('Zap');
	await expect(page.getByLabel('Vehicle Type')).toHaveValue('buggy');
	await expect(page.getByRole('combobox', { name: /^Driver\b/ })).toHaveValue('brawler');
	await expect(page.getByLabel('Driver name')).toHaveValue('Brick');
	await expect(page.getByRole('listitem').filter({ hasText: 'Machine Gun' })).toBeVisible();
	await expect(page.getByRole('listitem').filter({ hasText: 'Extra Armour' })).toBeVisible();
	await expect(page.getByRole('listitem').filter({ hasText: 'Battlehammer' })).toBeVisible();
	await page.waitForTimeout(500);
	await expect(page.locator('#rules-version')).toHaveValue('3');

	await page.reload({ waitUntil: 'domcontentloaded' });
	await expect(page.locator('#rules-version')).toHaveValue('3');
	dialog = await openTeams(page);
	await dialog.getByText('Refuelled Racers', { exact: true }).locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]').getByRole('button', { name: 'Load' }).click();
	await expect(page.locator('#rules-version')).toHaveValue('2');
	await expect(page.locator('#sponsor-select')).toHaveValue('rutherford');
	await expect(page.getByLabel('Team Name')).toHaveValue('Refuelled Racers');
	await expect(page.getByLabel('Maximum Cans')).toHaveValue('60');
	await expect(cansValue(page)).toHaveText(v2Cans);
	await page.getByRole('button', { name: 'Expand vehicle' }).click();
	await expect(page.getByLabel('Vehicle Name')).toHaveValue('Hauler');
	await expect(page.getByLabel('Vehicle Type')).toHaveValue('car');
	await expect(page.getByRole('listitem').filter({ hasText: 'Machine Gun' })).toBeVisible();
	await expect(page.getByRole('listitem').filter({ hasText: 'Ram' })).toBeVisible();
	await expect(page.getByRole('listitem').filter({ hasText: 'Powder Keg' })).toBeVisible();
	await page.waitForTimeout(500);
	await expect(page.locator('#rules-version')).toHaveValue('2');

	await page.getByLabel('Maximum Cans').fill('40');
	dialog = await openTeams(page);
	await saveNamedTeam(page, dialog, 'Refuelled Racers', notices, 'Team updated successfully');
	expect(notices.some((message) => message.includes('already exists'))).toBeTruthy();
	await dialog.getByRole('button', { name: 'Close teams modal' }).click();

	await page.reload({ waitUntil: 'domcontentloaded' });
	dialog = await openTeams(page);
	await dialog.getByText('Refuelled Racers', { exact: true }).locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]').getByRole('button', { name: 'Load' }).click();
	await expect(page.locator('#rules-version')).toHaveValue('2');
	await expect(page.getByLabel('Maximum Cans')).toHaveValue('40');
	await expect(page.locator('#sponsor-select')).toHaveValue('rutherford');
	await page.getByRole('button', { name: 'Expand vehicle' }).click();
	await expect(page.getByLabel('Vehicle Name')).toHaveValue('Hauler');
	await expect(page.getByRole('listitem').filter({ hasText: 'Powder Keg' })).toBeVisible();

	await page.getByLabel('Vehicle Name').fill('Hauler Two');
	await expect(page.getByLabel('Vehicle Name')).toHaveValue('Hauler Two');
	const beforeQuickSave = notices.length;
	await page.getByRole('button', { name: 'Quick Save' }).click();
	await expect.poll(() => notices.slice(beforeQuickSave).some((message) => message.includes('Team saved successfully'))).toBeTruthy();

	await page.reload({ waitUntil: 'domcontentloaded' });
	dialog = await openTeams(page);
	await dialog.getByText('Refuelled Racers', { exact: true }).locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]').getByRole('button', { name: 'Load' }).click();
	await expect(page.locator('#rules-version')).toHaveValue('2');
	await expect(page.getByLabel('Maximum Cans')).toHaveValue('40');
	await page.getByRole('button', { name: 'Expand vehicle' }).click();
	await expect(page.getByLabel('Vehicle Name')).toHaveValue('Hauler Two');
	await expect(page.locator('#sponsor-select')).toHaveValue('rutherford');
	await expect(page.getByRole('listitem').filter({ hasText: 'Machine Gun' })).toBeVisible();

	dialog = await openTeams(page);
	await dialog.getByText('Version Three Crew', { exact: true }).locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]').getByRole('button', { name: 'Delete' }).click();
	await expect(dialog.getByText('Version Three Crew', { exact: true })).toHaveCount(0);
	await expect(dialog.getByText('Refuelled Racers', { exact: true })).toBeVisible();
});
