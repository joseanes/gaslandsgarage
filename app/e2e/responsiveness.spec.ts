import { expect, test, type Page } from '@playwright/test';

type ListenerCounts = { add: Record<string, number>; remove: Record<string, number> };

function net(counts: ListenerCounts, key: string) {
	return (counts.add[key] ?? 0) - (counts.remove[key] ?? 0);
}

async function openGeneralSettings(page: Page) {
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('button', { name: 'General Settings' }).click();
	await expect(page.locator('#include-advanced')).toBeVisible();
}

async function watchLongTasks(page: Page) {
	await page.evaluate(() => {
		const durations: number[] = [];
		const observer = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) durations.push(entry.duration);
		});
		observer.observe({ type: 'longtask', buffered: false });
		(window as unknown as { __longTasks: number[] }).__longTasks = durations;
	});
}

async function longTaskMax(page: Page) {
	const durations = await page.evaluate(() => (window as unknown as { __longTasks?: number[] }).__longTasks ?? []);
	return durations.reduce((max, duration) => Math.max(max, duration), 0);
}

test('turning off Include Advanced stays responsive', async ({ page }) => {
	const pageErrors: string[] = [];
	page.on('pageerror', (error) => pageErrors.push(error.message));

	await page.goto('/builder');
	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	await expect(page.getByRole('button', { name: 'Expand vehicle' })).toHaveCount(1);

	await openGeneralSettings(page);
	await expect(page.locator('#include-advanced')).toBeChecked();
	await watchLongTasks(page);

	const started = Date.now();
	await page.locator('#include-advanced').click({ timeout: 5_000 });
	const clickMs = Date.now() - started;

	await page.getByRole('button', { name: 'Save and close settings' }).click();
	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	await expect(page.getByRole('button', { name: 'Expand vehicle' })).toHaveCount(2);

	const max = await longTaskMax(page);
	test.info().annotations.push({
		type: 'timing',
		description: `include-advanced click ${clickMs}ms, longest task ${Math.round(max)}ms`
	});
	expect(clickMs, `Include Advanced click took ${clickMs}ms`).toBeLessThan(3_000);
	expect(max, `longest task ${Math.round(max)}ms`).toBeLessThan(1_000);
	expect(pageErrors.join('\n')).not.toContain('effect_update_depth_exceeded');
});

test('turning off sponsorships stays responsive', async ({ page }) => {
	const pageErrors: string[] = [];
	page.on('pageerror', (error) => pageErrors.push(error.message));

	await page.goto('/builder');
	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	await expect(page.getByRole('button', { name: 'Expand vehicle' })).toHaveCount(1);

	await openGeneralSettings(page);
	await expect(page.locator('#enable-sponsorships')).toBeChecked();
	await watchLongTasks(page);

	const started = Date.now();
	await page.locator('#enable-sponsorships').click({ timeout: 5_000 });
	const clickMs = Date.now() - started;

	await page.getByRole('button', { name: 'Save and close settings' }).click();
	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	await expect(page.getByRole('button', { name: 'Expand vehicle' })).toHaveCount(2);

	const max = await longTaskMax(page);
	test.info().annotations.push({
		type: 'timing',
		description: `sponsorships click ${clickMs}ms, longest task ${Math.round(max)}ms`
	});
	expect(clickMs, `sponsorship click took ${clickMs}ms`).toBeLessThan(3_000);
	expect(max, `longest task ${Math.round(max)}ms`).toBeLessThan(1_000);
	expect(pageErrors.join('\n')).not.toContain('effect_update_depth_exceeded');
});

test('builder listeners stay at one after repeated client navigations', async ({ page }) => {
	await page.addInitScript(() => {
		const targetName = (target: EventTarget) => {
			if (target === window) return 'window';
			if (target === document) return 'document';
			return 'other';
		};
		const counts: ListenerCounts = { add: {}, remove: {} };
		const originalAdd = EventTarget.prototype.addEventListener;
		const originalRemove = EventTarget.prototype.removeEventListener;
		EventTarget.prototype.addEventListener = function (type, listener, options) {
			const key = `${targetName(this)}:${String(type)}`;
			counts.add[key] = (counts.add[key] ?? 0) + 1;
			return originalAdd.call(this, type, listener, options);
		};
		EventTarget.prototype.removeEventListener = function (type, listener, options) {
			const key = `${targetName(this)}:${String(type)}`;
			counts.remove[key] = (counts.remove[key] ?? 0) + 1;
			return originalRemove.call(this, type, listener, options);
		};
		(window as unknown as { __listenerCounts: ListenerCounts }).__listenerCounts = counts;
	});

	const readCounts = () =>
		page.evaluate(() => (window as unknown as { __listenerCounts: ListenerCounts }).__listenerCounts);

	await page.goto('/builder');
	await expect(page.getByRole('button', { name: '+ Add Vehicle' })).toBeVisible();
	const before = await readCounts();

	for (let round = 0; round < 6; round += 1) {
		await page.getByRole('link', { name: 'Privacy Policy' }).first().click();
		await expect(page).toHaveURL(/\/privacy$/);
		await page.getByRole('link', { name: 'Gaslands Garage home' }).click();
		await expect(page).toHaveURL(/\/builder$/);

		await page.getByRole('link', { name: 'Terms and Conditions' }).first().click();
		await expect(page).toHaveURL(/\/terms$/);
		await page.getByRole('link', { name: 'Gaslands Garage home' }).click();
		await expect(page).toHaveURL(/\/builder$/);
	}

	await page.getByRole('button', { name: 'Players', exact: true }).click();
	await page.getByRole('link', { name: 'Players Map' }).click();
	await expect(page).toHaveURL(/\/players$/);
	await page.getByRole('link', { name: 'Gaslands Garage home' }).click();
	await expect(page).toHaveURL(/\/builder$/);

	await page.getByRole('button', { name: 'Players', exact: true }).click();
	await page.getByRole('link', { name: 'My Profile' }).click();
	await expect(page).toHaveURL(/\/profile$/);
	await page.getByRole('link', { name: 'Gaslands Garage home' }).click();
	await expect(page).toHaveURL(/\/builder$/);

	await page.getByRole('button', { name: 'Help', exact: true }).click();
	await page.getByRole('link', { name: 'Usage Stats' }).click();
	await expect(page).toHaveURL(/\/stats$/);
	await page.getByRole('link', { name: 'Gaslands Garage home' }).click();
	await expect(page).toHaveURL(/\/builder$/);

	const after = await readCounts();
	const oneEach = [
		'document:gaslands-load-team-data',
		'window:gaslands-team-loaded',
		'window:message',
		'window:gaslands-menu-action'
	];
	for (const key of oneEach) {
		expect(net(after, key) - net(before, key), `${key} grew`).toBe(0);
		expect(net(after, key), key).toBe(1);
	}
	// Other startup scripts may register DOMContentLoaded once. The builder used
	// to add another copy on every client visit; that delta must stay at zero.
	expect(net(after, 'document:DOMContentLoaded') - net(before, 'document:DOMContentLoaded')).toBe(0);
});
