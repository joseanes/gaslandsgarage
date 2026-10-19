import { expect, test, type Page } from '@playwright/test';

function watchDialogs(page: Page) {
	const messages: string[] = [];
	page.on('dialog', async (dialog) => {
		messages.push(dialog.message());
		await dialog.accept();
	});
	return messages;
}

function builderPageAlerts(messages: string[]) {
	return messages.filter((message) => /builder page|not available/i.test(message));
}

async function holdHome(page: Page) {
	await page.addInitScript(() => {
		const mark = () => {
			if (document.documentElement) document.documentElement.setAttribute('data-hold-home', '');
		};
		mark();
		const timer = window.setInterval(mark, 1);
		window.addEventListener('load', () => {
			mark();
			window.setTimeout(() => window.clearInterval(timer), 1000);
		});
	});
}

const SHARE_TEAM_ITEMS = new Set(['Copy to Clipboard', 'Share Link', 'Generate QR Code']);

async function openTeamsItem(page: Page, name: string) {
	await page.getByRole('button', { name: 'Teams', exact: true }).click();
	if (SHARE_TEAM_ITEMS.has(name)) await page.getByRole('button', { name: 'Share Team', exact: true }).click();
	await page.getByRole('button', { name, exact: true }).click();
}

async function expectMyTeamsSignedOut(page: Page) {
	const dialog = page.getByRole('dialog', { name: 'My Teams' });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByText('Please sign in to save and load teams.')).toBeVisible();
	await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
	await expect(page).toHaveURL(/\/builder(?:\?|$)/);
}

test('signed-out Save/Load from Usage Stats opens My Teams on the builder', async ({ page }) => {
	const messages = watchDialogs(page);
	await page.goto('/stats', { waitUntil: 'domcontentloaded' });
	await openTeamsItem(page, 'Save/Load Team');
	await expectMyTeamsSignedOut(page);
	await page.reload({ waitUntil: 'domcontentloaded' });
	await expect(page.getByRole('dialog', { name: 'My Teams' })).toHaveCount(0);
	expect(builderPageAlerts(messages)).toEqual([]);
});

test('signed-out Save/Load from the home page opens My Teams on the builder', async ({ page }) => {
	const messages = watchDialogs(page);
	await holdHome(page);
	await page.goto('/', { waitUntil: 'domcontentloaded' });
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByText('Redirecting to Gaslands Garage...')).toBeVisible();
	await openTeamsItem(page, 'Save/Load Team');
	await expectMyTeamsSignedOut(page);
	expect(builderPageAlerts(messages)).toEqual([]);
});

test('signed-out Teams actions from Usage Stats open the builder without an alert', async ({ page }) => {
	const messages = watchDialogs(page);
	const needsTeam: Array<[string, string]> = [
		['Print Team', 'Add a vehicle to this team before printing.'],
		['Print with photos', 'Add a vehicle to this team before printing with photos.'],
		['Copy to Clipboard', 'Add a vehicle to this team before copying it.'],
		['Share Link', 'Add a vehicle to this team before sharing a link.'],
		['Generate QR Code', 'Add a vehicle to this team before generating a QR code.']
	];

	for (const [label, notice] of needsTeam) {
		await page.goto('/stats', { waitUntil: 'domcontentloaded' });
		await openTeamsItem(page, label);
		await expect(page).toHaveURL(/\/builder/);
		await expect(page.getByTestId('team-action-notice')).toHaveText(notice);
	}

	await page.goto('/stats', { waitUntil: 'domcontentloaded' });
	await openTeamsItem(page, 'Import Build');
	await expect(page.getByRole('dialog', { name: 'Import Build' })).toBeVisible();
	expect(builderPageAlerts(messages)).toEqual([]);
	expect(messages).toEqual([]);
});

test('a saved team stays available from Usage Stats and the home page', async ({ page }) => {
	test.setTimeout(120_000);
	const messages = watchDialogs(page);
	const email = `menu-${Date.now()}@example.com`;
	await page.addInitScript(() => localStorage.setItem('gaslands-firebase-emulators', '1'));
	await page.goto('/builder', { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => typeof window.signInEmulatorUser === 'function');
	await page.evaluate(async (address) => {
		await window.signInEmulatorUser!(address, 'password123');
	}, email);
	await expect(page.getByRole('button', { name: email.split('@')[0] })).toBeVisible();

	await page.getByLabel('Team Name').fill('Stats Racers');
	await page.locator('#sponsor-select').selectOption('rutherford');
	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	await openTeamsItem(page, 'Save/Load Team');
	const saving = page.getByRole('dialog', { name: 'My Teams' });
	await saving.getByRole('button', { name: 'Save', exact: true }).click();
	await expect.poll(() => messages.some((message) => message.includes('Team saved successfully'))).toBeTruthy();
	await expect(saving.getByText('Stats Racers', { exact: true })).toBeVisible();
	await saving.getByRole('button', { name: 'Close teams modal' }).click();

	await page.goto('/stats', { waitUntil: 'domcontentloaded' });
	await openTeamsItem(page, 'Save/Load Team');
	const fromStats = page.getByRole('dialog', { name: 'My Teams' });
	await expect(fromStats).toBeVisible();
	await expect(fromStats.getByText('Stats Racers', { exact: true })).toBeVisible();
	await expect(page).toHaveURL(/\/builder/);
	await fromStats.getByRole('button', { name: 'Close teams modal' }).click();

	await holdHome(page);
	await page.goto('/', { waitUntil: 'domcontentloaded' });
	await expect(page).toHaveURL(/\/$/);
	await openTeamsItem(page, 'Save/Load Team');
	const fromHome = page.getByRole('dialog', { name: 'My Teams' });
	await expect(fromHome).toBeVisible();
	await expect(fromHome.getByText('Stats Racers', { exact: true })).toBeVisible();
	await expect(page).toHaveURL(/\/builder/);
	expect(builderPageAlerts(messages)).toEqual([]);
});

test('Copy from Usage Stats brings the current team back to the builder', async ({ page, context }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	const messages = watchDialogs(page);
	await page.goto('/builder', { waitUntil: 'domcontentloaded' });
	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	await page.getByRole('button', { name: 'Expand vehicle' }).click();
	await page.getByLabel('Vehicle Name').fill('Hauler');
	await page.goto('/stats', { waitUntil: 'domcontentloaded' });
	await openTeamsItem(page, 'Copy to Clipboard');
	await expect(page.getByTestId('vehicle-summary')).toContainText('Hauler');
	await expect.poll(() => messages.some((message) => message.includes('Draft copied to clipboard'))).toBeTruthy();
	expect(builderPageAlerts(messages)).toEqual([]);
});
