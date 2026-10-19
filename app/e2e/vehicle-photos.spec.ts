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

test('a signed-in player can upload, view, print, and delete a vehicle photo', async ({ page }) => {
	test.setTimeout(120_000);
	const messages = watchDialogs(page);
	const email = `photos-${Date.now()}@example.com`;
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

	await page.getByLabel('Team Name').fill('Photo Racers');
	await page.locator('#sponsor-select').selectOption('rutherford');
	await page.getByRole('button', { name: '+ Add Vehicle' }).click();
	await page.getByRole('button', { name: 'Teams', exact: true }).click();
	await page.getByRole('button', { name: 'Save/Load Team', exact: true }).click();
	const saving = page.getByRole('dialog', { name: 'My Teams' });
	await saving.getByRole('button', { name: 'Save', exact: true }).click();
	await expect.poll(() => messages.some((message) => message.includes('Team saved successfully'))).toBeTruthy();
	await saving.getByRole('button', { name: 'Close teams modal' }).click();

	await page.getByRole('button', { name: 'Expand vehicle' }).click();
	const photos = page.getByTestId('vehicle-photos');
	await expect(photos).toBeVisible();
	await expect(photos.getByTestId('upload-share-gallery')).not.toBeChecked();
	await expect(photos.getByTestId('upload-share-stats')).not.toBeChecked();

	await photos.getByTestId('vehicle-photo-input').setInputFiles({
		name: 'painted-car.png',
		mimeType: 'image/png',
		buffer: TINY_PNG
	});
	const thumbnail = photos.getByRole('img', { name: 'Painted car' });
	await expect(thumbnail).toBeVisible({ timeout: 30_000 });
	await expect(photos.getByRole('alert')).toHaveCount(0);
	await expect(photos.getByTestId('upload-share-gallery')).not.toBeChecked();
	await expect(photos.getByTestId('upload-share-stats')).not.toBeChecked();

	await page.getByRole('button', { name: 'Teams', exact: true }).click();
	const popupPromise = page.waitForEvent('popup');
	await page.getByRole('button', { name: 'Print with photos', exact: true }).click();
	const popup = await popupPromise;
	const printed = popup.locator('.vehicle-photos img');
	await expect(printed).toHaveCount(1, { timeout: 30_000 });
	await expect.poll(async () => printed.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBeTruthy();
	await popup.close();

	await photos.getByRole('button', { name: 'Delete photo' }).click();
	await expect.poll(() => messages.some((message) => message.includes('Delete this photo?'))).toBeTruthy();
	await expect(thumbnail).toHaveCount(0);
	await expect(photos.getByRole('alert')).toHaveCount(0);
});
