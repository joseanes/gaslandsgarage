import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const shotDir = '/opt/cursor/artifacts/screenshots';

const TEAM_MENU = [
	'New',
	'Save/Load Team',
	'Print Team',
	'Print with photos',
	'Share Team',
	'Import Build'
];

test.beforeAll(() => {
	fs.mkdirSync(shotDir, { recursive: true });
});

async function prepare(page: Page, width: number, height: number) {
	await page.addInitScript(() => {
		localStorage.setItem(
			'gaslands.analyticsConsent.v1',
			JSON.stringify({ choice: 'rejected', at: '2026-01-01T00:00:00.000Z', gpc: false })
		);
	});
	await page.setViewportSize({ width, height });
}

async function menuLabels(page: Page) {
	const menu = page.locator('.share-menu-dropdown');
	await expect(menu).toBeVisible();
	return menu.locator('a, button').evaluateAll((items) =>
		items.map((item) => item.textContent?.replace(/\s+/g, ' ').trim())
	);
}

async function leaveForStats(page: Page) {
	await page.getByRole('button', { name: 'Help', exact: true }).click();
	await page.getByRole('link', { name: 'Usage Stats' }).click();
	await expect(page).toHaveURL(/\/stats/);
}

test('Back to my team stays hidden on the builder and when nothing is in progress', async ({ page }) => {
	await prepare(page, 1280, 800);
	await page.goto('/stats', { waitUntil: 'domcontentloaded' });
	await page.getByRole('button', { name: 'Teams', exact: true }).click();
	await expect(page.getByTestId('back-to-team')).toHaveCount(0);
	expect(await menuLabels(page)).toEqual(TEAM_MENU);

	await page.goto('/builder', { waitUntil: 'domcontentloaded' });
	await page.getByLabel('Team Name').fill('Road Warriors');
	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	await expect(page.getByTestId('vehicle-summary')).toHaveCount(1);
	await page.getByRole('button', { name: 'Teams', exact: true }).click();
	await expect(page.getByTestId('back-to-team')).toHaveCount(0);
	expect(await menuLabels(page)).toEqual(TEAM_MENU);

	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: 'New', exact: true }).click();
	await expect(page.getByLabel('Team Name')).toHaveValue('My Gaslands Team');
	await leaveForStats(page);
	await page.getByRole('button', { name: 'Teams', exact: true }).click();
	await expect(page.getByTestId('back-to-team')).toHaveCount(0);
	expect(await menuLabels(page)).toEqual(TEAM_MENU);
});

test('a renamed team with no cars is still the active team', async ({ page }) => {
	await prepare(page, 1280, 800);
	await page.goto('/builder', { waitUntil: 'domcontentloaded' });
	await page.getByLabel('Team Name').fill('Road Warriors');
	await leaveForStats(page);
	await page.getByRole('button', { name: 'Teams', exact: true }).click();
	const back = page.getByTestId('back-to-team');
	await expect(back).toHaveText('Back to my team: Road Warriors');
	await expect(back).toHaveAttribute('href', '/builder');
	expect(await menuLabels(page)).toEqual(['Back to my team: Road Warriors', ...TEAM_MENU]);
	await back.click();
	await expect(page).toHaveURL(/\/builder\/?$/);
	await expect(page.getByLabel('Team Name')).toHaveValue('Road Warriors');
	await expect(page.getByText('Your team has no vehicles yet')).toBeVisible();
	await page.getByRole('button', { name: 'Teams', exact: true }).click();
	await expect(page.getByTestId('back-to-team')).toHaveCount(0);
});

async function buildRoadWarriors(page: Page) {
	await page.goto('/builder', { waitUntil: 'domcontentloaded' });
	await page.locator('#rules-version').selectOption('3');
	await page.getByLabel('Team Name').fill('Road Warriors');
	await page.locator('#sponsor-select').selectOption('beverly');
	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	await page.getByRole('button', { name: 'Expand vehicle' }).click();
	await page.getByLabel('Vehicle Name').fill('Scout');
	await expect(page.getByLabel('Vehicle Name')).toHaveValue('Scout');
	await page.getByRole('button', { name: 'Collapse vehicle' }).click();
	await expect(page.getByTestId('vehicle-summary')).toContainText('Scout');
}

async function expectRoadWarriorsRestored(page: Page) {
	await expect(page).toHaveURL(/\/builder\/?$/);
	await expect(page.getByLabel('Team Name')).toHaveValue('Road Warriors');
	await expect(page.locator('#sponsor-select')).toHaveValue('beverly');
	await expect(page.locator('#rules-version')).toHaveValue('3');
	await expect(page.getByTestId('vehicle-summary')).toContainText('Scout');
	await expect(page.getByText('Your team has no vehicles yet')).toHaveCount(0);
}

test('Back to my team restores the unsaved draft from another page', async ({ page }) => {
	await prepare(page, 1280, 800);
	await page.goto('/builder', { waitUntil: 'domcontentloaded' });
	await buildRoadWarriors(page);
	await leaveForStats(page);
	await page.getByRole('button', { name: 'Teams', exact: true }).click();
	const menu = page.locator('.share-menu-dropdown');
	await expect(menu.getByTestId('back-to-team')).toHaveText('Back to my team: Road Warriors');
	expect(await menuLabels(page)).toEqual(['Back to my team: Road Warriors', ...TEAM_MENU]);
	await expect(menu.getByRole('button', { name: 'New', exact: true })).toBeVisible();
	await page.screenshot({ path: `${shotDir}/back-to-team-desktop.png` });
	await menu.screenshot({ path: `${shotDir}/back-to-team-desktop-menu.png` });
	await menu.getByTestId('back-to-team').click();
	await expectRoadWarriorsRestored(page);
});

test('Back to my team restores the unsaved draft from the phone menu', async ({ page }) => {
	await prepare(page, 375, 812);
	await buildRoadWarriors(page);
	await leaveForStats(page);
	await page.getByRole('button', { name: 'Teams', exact: true }).click();
	const menu = page.locator('.share-menu-dropdown');
	const back = menu.getByTestId('back-to-team');
	await expect(back).toHaveText('Back to my team: Road Warriors');
	await expect
		.poll(async () => {
			const box = await menu.boundingBox();
			return !!box && box.x >= -0.5 && box.x + box.width <= 375.5 && box.y >= -0.5;
		})
		.toBe(true);
	await page.screenshot({ path: `${shotDir}/back-to-team-mobile.png` });
	await menu.screenshot({ path: `${shotDir}/back-to-team-mobile-menu.png` });
	await back.click();
	await expectRoadWarriorsRestored(page);
});

test('Back to my team restores a saved team kept in the browser', async ({ page }) => {
	await prepare(page, 1280, 800);
	const draft = {
		sponsor: 'rutherford',
		vehicles: [{ id: 'v1', type: 'car', name: 'Scout', weapons: [], upgrades: [], perks: [] }],
		teamName: 'Road Warriors',
		maxCans: 50,
		darkMode: false,
		rulesVersion: 2,
		savedTeamId: 'saved-team-1',
		cleanSignature: ''
	};
	draft.cleanSignature = JSON.stringify({
		teamName: draft.teamName,
		sponsorId: draft.sponsor,
		maxCans: draft.maxCans,
		rulesVersion: draft.rulesVersion,
		vehicles: draft.vehicles
	});
	await page.addInitScript((stored) => {
		localStorage.setItem('gaslands-builder-draft', JSON.stringify(stored));
	}, draft);

	await page.goto('/gallery', { waitUntil: 'domcontentloaded' });
	await page.getByRole('button', { name: 'Teams', exact: true }).click();
	const back = page.getByTestId('back-to-team');
	await expect(back).toHaveText('Back to my team: Road Warriors');
	await back.click();
	await expect(page).toHaveURL(/\/builder\/?$/);
	await expect(page.getByLabel('Team Name')).toHaveValue('Road Warriors');
	await expect(page.locator('#sponsor-select')).toHaveValue('rutherford');
	await expect(page.locator('#rules-version')).toHaveValue('2');
	await expect(page.getByTestId('vehicle-summary')).toContainText('Scout');
	await expect
		.poll(async () =>
			page.evaluate(() => {
				const raw = localStorage.getItem('gaslands-builder-draft');
				return raw ? (JSON.parse(raw) as { savedTeamId?: string }).savedTeamId : '';
			})
		)
		.toBe('saved-team-1');
});
