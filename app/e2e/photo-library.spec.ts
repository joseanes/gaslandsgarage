import { expect, test, type Page } from '@playwright/test';

/** 1×1 PNG. The builder re-encodes it before the reserved upload. */
const TINY_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64'
);

function watchDialogs(page: Page) {
	const messages: string[] = [];
	page.on('dialog', async (dialog) => {
		messages.push(dialog.message());
		await dialog.accept();
	});
	return messages;
}

test('a library photo survives deleting one car and is removed when the photo is deleted', async ({ page }) => {
	test.setTimeout(120_000);
	const messages = watchDialogs(page);
	const email = `library-${Date.now()}@example.com`;
	await page.addInitScript(() => {
		localStorage.setItem('gaslands-firebase-emulators', '1');
		localStorage.setItem('hasRules', 'true');
		localStorage.setItem('printRulesPromptSeen', 'true');
	});
	await page.goto('/builder', { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => typeof window.signInEmulatorUser === 'function');
	await page.evaluate(async (address) => {
		await window.signInEmulatorUser!(address, 'password123');
	}, email);
	await expect(page.getByRole('button', { name: email.split('@')[0] })).toBeVisible();

	await page.getByLabel('Team Name').fill('Photo Library');
	await page.locator('#sponsor-select').selectOption('rutherford');
	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	const first = page.locator('.vehicle-card').nth(0);
	await first.getByRole('button', { name: 'Expand vehicle' }).click();
	await first.getByLabel('Vehicle Name').fill('First Car');
	await page.getByRole('button', { name: 'Teams', exact: true }).click();
	await page.getByRole('button', { name: 'Save/Load Team', exact: true }).click();
	const saving = page.getByRole('dialog', { name: 'My Teams' });
	await saving.getByRole('button', { name: 'Save', exact: true }).click();
	await expect.poll(() => messages.some((message) => message.includes('Team saved successfully'))).toBeTruthy();
	await saving.getByRole('button', { name: 'Close teams modal' }).click();

	await first.getByTestId('vehicle-photo-input').setInputFiles({
		name: 'painted-car.png',
		mimeType: 'image/png',
		buffer: TINY_PNG
	});
	await expect(first.getByRole('img', { name: 'Painted car' })).toBeVisible({ timeout: 30_000 });

	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	const second = page.locator('.vehicle-card').nth(1);
	await second.getByRole('button', { name: 'Expand vehicle' }).click();
	await second.getByLabel('Vehicle Name').fill('Second Car');
	await page.getByRole('button', { name: 'Teams', exact: true }).click();
	await page.getByRole('button', { name: 'Save/Load Team', exact: true }).click();
	await expect(saving.getByText('Photo Library', { exact: true })).toBeVisible();
	const beforeUpdate = messages.length;
	await saving.getByRole('button', { name: 'Save', exact: true }).click();
	await expect.poll(() => messages.slice(beforeUpdate).join('\n'), { timeout: 20_000 }).toContain('Team updated successfully');
	await saving.getByRole('button', { name: 'Close teams modal' }).click();
	const expandSecond = second.getByRole('button', { name: 'Expand vehicle' });
	if (await expandSecond.count()) await expandSecond.click();

	await second.getByTestId('choose-library-photo').click();
	await second.getByTestId('library-pick').click();
	await expect(second.getByRole('img', { name: 'Painted car' })).toBeVisible({ timeout: 30_000 });

	await first.getByRole('button', { name: 'Remove vehicle' }).click();
	await expect(page.locator('.vehicle-card')).toHaveCount(1);
	await expect(page.getByRole('img', { name: 'Painted car' })).toBeVisible();

	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByTestId('my-photos-link').click();
	await expect(page.getByTestId('photo-usage')).toHaveText('1 of 100 used', { timeout: 30_000 });
	const libraryPhoto = page.getByTestId('library-photo');
	await expect(libraryPhoto.getByTestId('photo-used-by')).toHaveText('On: Photo Library: Second Car');

	await libraryPhoto.getByTestId('delete-library-photo').click();
	await expect.poll(() => messages.some((message) => message.includes('Second Car') && message.includes('Delete this photo?')), { timeout: 20_000 }).toBeTruthy();
	await expect(page.getByTestId('photo-usage')).toHaveText('0 of 100 used');
	await expect(page.getByRole('img', { name: 'Painted car' })).toHaveCount(0);

	await page.goto('/builder', { waitUntil: 'domcontentloaded' });
	await page.getByRole('button', { name: 'Teams', exact: true }).click();
	await page.getByRole('button', { name: 'Save/Load Team', exact: true }).click();
	const loaded = page.getByRole('dialog', { name: 'My Teams' });
	await loaded.getByText('Photo Library', { exact: true }).locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]').getByRole('button', { name: 'Load' }).click();
	await expect(loaded).toHaveCount(0);
	await page.getByRole('button', { name: 'Expand vehicle' }).first().click();
	await expect(page.getByRole('img', { name: 'Painted car' })).toHaveCount(0);
});
