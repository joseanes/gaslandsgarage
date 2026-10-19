import { expect, test, type Page } from '@playwright/test';

/**
 * Leaflet tiles are painted above the page but use pointer-events: none, so a
 * normal hit test misses them. Turning hits on makes elementFromPoint report
 * whichever element is actually painted on top.
 */
const tileHits =
	'.leaflet-tile, .leaflet-pane, .leaflet-control { pointer-events: auto !important; }';

async function openPlayers(page: Page, width: number, height: number) {
	await page.addInitScript(() => {
		localStorage.setItem('gaslands-firebase-emulators', '1');
		localStorage.setItem(
			'gaslands.analyticsConsent.v1',
			JSON.stringify({ choice: 'rejected', at: '2026-01-01T00:00:00.000Z', gpc: false })
		);
	});
	await page.setViewportSize({ width, height });
	await page.goto('/players');
	await expect(page.getByRole('heading', { name: 'Players map' })).toBeVisible();
	await expect(page.getByTestId('players-loading')).toHaveCount(0, { timeout: 15_000 });
	await expect(page.getByTestId('players-error')).toHaveCount(0);
	await expect(page.getByTestId('players-map')).toBeVisible();
	await expect(page.locator('.leaflet-tile-loaded').first()).toBeVisible({ timeout: 15_000 });
	await page.addStyleTag({ content: tileHits });
}

async function overlap(page: Page, selector: string) {
	return page.evaluate((targetSelector) => {
		const target = document.querySelector(targetSelector);
		const map = document.querySelector('.leaflet-container');
		if (!target || !map) return null;
		const area = target.getBoundingClientRect();
		const tiles = map.getBoundingClientRect();
		const left = Math.max(area.left, tiles.left);
		const top = Math.max(area.top, tiles.top);
		const right = Math.min(area.right, tiles.right, window.innerWidth);
		const bottom = Math.min(area.bottom, tiles.bottom, window.innerHeight);
		if (right - left < 8 || bottom - top < 8) return null;
		return { x: (left + right) / 2, y: (top + bottom) / 2 };
	}, selector);
}

async function hitAt(page: Page, point: { x: number; y: number }) {
	return page.evaluate(({ x, y }) => {
		const el = document.elementFromPoint(x, y);
		const label = el ? `${el.tagName}.${typeof el.className === 'string' ? el.className : ''}` : 'none';
		return {
			menu: !!el?.closest('.help-menu-dropdown'),
			modal: !!el?.closest('.settings-modal-content'),
			leaflet: !!el?.closest('[class*="leaflet-"]'),
			label: label.slice(0, 120)
		};
	}, point);
}

for (const viewport of [
	{ width: 1280, height: 800 },
	{ width: 375, height: 812 }
]) {
	test(`Help menu stays above the players map at ${viewport.width}px`, async ({ page }) => {
		await openPlayers(page, viewport.width, viewport.height);
		await page.getByRole('button', { name: 'Help', exact: true }).click();
		const menu = page.locator('.help-menu-dropdown');
		const last = menu.locator('button, a').last();
		await expect(last).toBeVisible();
		await expect(last).toHaveText('Contact Us');

		const point = await overlap(page, '.help-menu-dropdown button:last-of-type');
		expect(point, 'the last Help item should overlap the map').not.toBeNull();
		const hit = await hitAt(page, point!);
		expect(hit.leaflet, hit.label).toBe(false);
		expect(hit.menu, hit.label).toBe(true);

		await last.click();
		await expect(page.getByRole('dialog', { name: 'Contact Us' })).toBeVisible();
	});

	test(`Settings dialog stays above the players map at ${viewport.width}px`, async ({ page }) => {
		await openPlayers(page, viewport.width, viewport.height);
		await page.getByRole('button', { name: 'Settings', exact: true }).click();
		await page.getByRole('button', { name: 'General Settings', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: 'Settings' });
		await expect(dialog).toBeVisible();
		await expect(dialog.getByText('I have the Gaslands Refuelled rulebook')).toBeVisible();

		const point = await overlap(page, '.settings-modal-content');
		expect(point, 'the Settings dialog should overlap the map').not.toBeNull();
		const hit = await hitAt(page, point!);
		expect(hit.leaflet, hit.label).toBe(false);
		expect(hit.modal, hit.label).toBe(true);
	});
}
