import { expect, test } from '@playwright/test';

async function expandNewCar(page: import('@playwright/test').Page) {
	await page.goto('/builder');
	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	await page.getByRole('button', { name: 'Expand vehicle' }).click();
	return page.getByRole('combobox', { name: 'Add a weapon' });
}

test('typing machine adds Heavy Machine Gun and leaves the field ready', async ({ page }) => {
	const input = await expandNewCar(page);
	await input.click();
	await input.fill('machine');

	const heavy = page.getByRole('option', { name: /Heavy Machine Gun/ });
	await expect(heavy.locator('mark')).toHaveText(/machine/i);
	await expect(heavy).toContainText('Double');
	await expect(heavy).toContainText('3 cans');
	await heavy.click();

	await expect(page.getByRole('listitem').filter({ hasText: 'Heavy Machine Gun' })).toBeVisible();
	await expect(input).toBeFocused();
	await expect(input).toHaveValue('');
	await expect(page.getByRole('listbox', { name: 'Add a weapon' })).toBeVisible();
});

test('a weapon that does not fit stays visible and cannot be picked', async ({ page }) => {
	const input = await expandNewCar(page);
	await input.click();
	await input.fill('tank');

	const tank = page.getByRole('option', { name: /Tank Cannon/ });
	await expect(tank).toBeVisible();
	await expect(tank).toHaveAttribute('aria-disabled', 'true');
	await expect(tank).toContainText('Insufficient slots');
	await tank.click({ force: true });
	await page.keyboard.press('Enter');

	await expect(page.getByRole('listitem').filter({ hasText: 'Tank Cannon' })).toHaveCount(0);
	await expect(page.getByText('No weapons installed.')).toBeVisible();
});

test('arrow keys, Enter, Escape, and Tab drive the adder', async ({ page }) => {
	const input = await expandNewCar(page);
	await input.click();
	await input.fill('machine');

	const heavy = page.getByRole('option', { name: /Heavy Machine Gun/ });
	const machineGun = page.getByRole('option', { name: /^Machine Gun\b/ });
	await expect(heavy).toHaveAttribute('aria-selected', 'true');

	await page.keyboard.press('ArrowDown');
	await expect(machineGun).toHaveAttribute('aria-selected', 'true');
	await page.keyboard.press('ArrowUp');
	await expect(heavy).toHaveAttribute('aria-selected', 'true');
	await page.keyboard.press('Enter');

	await expect(page.getByRole('listitem').filter({ hasText: 'Heavy Machine Gun' })).toBeVisible();
	await expect(input).toBeFocused();

	await input.fill('hand');
	await expect(page.getByRole('option', { name: /^Handgun\b/ })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('listbox')).toHaveCount(0);
	await expect(input).toHaveValue('hand');

	await input.click();
	await expect(page.getByRole('listbox', { name: 'Add a weapon' })).toBeVisible();
	await page.keyboard.press('Tab');
	await expect(page.getByRole('listbox', { name: 'Add a weapon' })).toHaveCount(0);
	await expect(input).not.toBeFocused();
});

test('the open list stays on screen on a short phone', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 420 });
	const input = await expandNewCar(page);
	await input.evaluate((element) => element.scrollIntoView({ block: 'end' }));
	await input.click();
	await input.fill('machine');

	const list = page.getByRole('listbox', { name: 'Add a weapon' });
	await expect(list).toBeVisible();
	const box = await list.boundingBox();
	expect(box).toBeTruthy();
	expect(box!.y).toBeGreaterThanOrEqual(0);
	expect(box!.y + box!.height).toBeLessThanOrEqual(421);
	const visible = await list.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		const hit = document.elementFromPoint(rect.left + 12, Math.min(rect.bottom - 8, rect.top + 24));
		return !!hit && (element === hit || element.contains(hit));
	});
	expect(visible).toBe(true);
	await page.getByRole('option', { name: /Heavy Machine Gun/ }).click();
	await expect(page.getByRole('listitem').filter({ hasText: 'Heavy Machine Gun' })).toBeVisible();
});
