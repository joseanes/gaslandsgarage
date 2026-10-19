import { expect, test, type Page } from '@playwright/test';

/**
 * Leaflet tiles are painted above the page but use pointer-events: none, so a
 * normal hit test misses them. Turning hits on makes elementFromPoint report
 * whichever element is actually painted on top.
 */
const tileHits =
	'.leaflet-tile, .leaflet-pane, .leaflet-control { pointer-events: auto !important; }';

async function useEmulator(page: Page) {
	await page.addInitScript(() => {
		localStorage.setItem('gaslands-firebase-emulators', '1');
		localStorage.setItem(
			'gaslands.analyticsConsent.v1',
			JSON.stringify({ choice: 'rejected', at: '2026-01-01T00:00:00.000Z', gpc: false })
		);
	});
}

async function signIn(page: Page, email: string) {
	await useEmulator(page);
	await page.goto('/builder', { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => typeof window.signInEmulatorUser === 'function');
	await page.evaluate(async (address) => {
		await window.signInEmulatorUser!(address, 'password123');
	}, email);
	await expect(page.getByRole('button', { name: email.split('@')[0] })).toBeVisible();
}

async function openPlayers(page: Page, width: number, height: number) {
	await page.setViewportSize({ width, height });
	await page.goto('/players', { waitUntil: 'domcontentloaded' });
	await expect(page.getByRole('heading', { name: 'Players map' })).toBeVisible();
	await expect(page.getByTestId('players-loading')).toHaveCount(0, { timeout: 15_000 });
	await expect(page.getByTestId('players-error')).toHaveCount(0);
	await expect(page.getByTestId('players-map')).toBeVisible();
	await expect(page.locator('.leaflet-tile-loaded').first()).toBeVisible({ timeout: 15_000 });
	await page.addStyleTag({ content: tileHits });
}

/** Scroll the map up under the sticky Help menu until Upcoming Features sits on it. */
async function scrollMapUnderUpcoming(page: Page) {
	await page.evaluate(() => {
		const menu = document.querySelector('.help-menu-dropdown');
		const map = document.querySelector('.leaflet-container');
		if (!menu || !map) return;
		const item = [...menu.querySelectorAll('button, a')].find((el) => el.textContent?.trim() === 'Upcoming Features');
		if (!item) return;
		const delta = map.getBoundingClientRect().top - item.getBoundingClientRect().top;
		if (delta > 1) window.scrollBy(0, delta);
	});
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

async function overlapMenuItem(page: Page, label: string) {
	return page.evaluate((itemLabel) => {
		const menu = document.querySelector('.help-menu-dropdown');
		const map = document.querySelector('.leaflet-container');
		if (!menu || !map) return null;
		const target = [...menu.querySelectorAll('button, a')].find((el) => el.textContent?.trim() === itemLabel);
		if (!target) return null;
		const area = target.getBoundingClientRect();
		const tiles = map.getBoundingClientRect();
		const left = Math.max(area.left, tiles.left);
		const top = Math.max(area.top, tiles.top);
		const right = Math.min(area.right, tiles.right, window.innerWidth);
		const bottom = Math.min(area.bottom, tiles.bottom, window.innerHeight);
		if (right - left < 8 || bottom - top < 8) return null;
		return { x: (left + right) / 2, y: (top + bottom) / 2 };
	}, label);
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

const headerMenus = [
	['Teams', '.share-menu-dropdown'],
	['Settings', '.settings-menu-dropdown'],
	['Players', '.players-menu-dropdown'],
	['Help', '.help-menu-dropdown']
] as const;

for (const viewport of [
	{ width: 1280, height: 800 },
	{ width: 375, height: 812 }
]) {
	test(`header dropdowns stay on screen at ${viewport.width}px`, async ({ page }) => {
		await useEmulator(page);
		await openPlayers(page, viewport.width, viewport.height);
		for (const [name, selector] of headerMenus) {
			await page.getByRole('button', { name, exact: true }).click();
			const menu = page.locator(selector);
			await expect(menu).toBeVisible();
			await expect.poll(async () => {
				const box = await menu.boundingBox();
				return !!box && box.x >= -0.5 && box.x + box.width <= viewport.width + 0.5;
			}).toBe(true);
			await page.getByRole('button', { name, exact: true }).click();
			await expect(menu).toBeHidden();
		}
	});

	test(`Help menu stays above the players map at ${viewport.width}px`, async ({ page }) => {
		const email = `help${viewport.width}@example.com`;
		await signIn(page, email);
		await openPlayers(page, viewport.width, viewport.height);
		await page.getByRole('button', { name: email.split('@')[0] }).click();
		const account = page.locator('.auth-container .dropdown');
		await expect(account).toBeVisible();
		await expect.poll(async () => {
			const box = await account.boundingBox();
			return !!box && box.x >= -0.5 && box.x + box.width <= viewport.width + 0.5;
		}).toBe(true);
		await page.getByRole('button', { name: email.split('@')[0] }).click();

		await page.getByRole('button', { name: 'Help', exact: true }).click();
		const menu = page.locator('.help-menu-dropdown');
		const last = menu.locator('button, a').last();
		await expect(last).toBeVisible();
		await expect(last).toHaveText('Contact Us');
		await expect.poll(async () => menu.boundingBox().then((box) => (box ? box.x + box.width : viewport.width + 99))).toBeLessThanOrEqual(
			viewport.width
		);

		await scrollMapUnderUpcoming(page);
		for (const label of ['Upcoming Features', 'Contributors', 'Contact Us']) {
			const point = await overlapMenuItem(page, label);
			expect(point, `${label} should overlap the map`).not.toBeNull();
			const hit = await hitAt(page, point!);
			expect(hit.leaflet, `${label} ${hit.label}`).toBe(false);
			expect(hit.menu, `${label} ${hit.label}`).toBe(true);
		}

		await last.click();
		await expect(page.getByRole('dialog', { name: 'Contact Us' })).toBeVisible();
	});

	test(`Settings dialog stays above the players map at ${viewport.width}px`, async ({ page }) => {
		await useEmulator(page);
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
