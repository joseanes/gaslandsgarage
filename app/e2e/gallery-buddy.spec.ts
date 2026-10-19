import { expect, test, type Page } from '@playwright/test';
import { emulatorFirestore } from './emulatorAdmin';

const TINY_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64'
);
const OTHER_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64'
);

async function signIn(page: Page, email: string) {
	await page.addInitScript(() => {
		localStorage.setItem('gaslands-firebase-emulators', '1');
		localStorage.setItem('hasRules', 'true');
		localStorage.setItem('printRulesPromptSeen', 'true');
	});
	if (!page.url().includes('/gallery') && !page.url().includes('/buddies')) {
		await page.goto('/gallery', { waitUntil: 'domcontentloaded' });
	}
	await page.waitForFunction(() => typeof window.signInEmulatorUser === 'function');
	const uid = await page.evaluate(async (address) => {
		await window.signInEmulatorUser!(address, 'password123');
		return window.emulatorAuthState?.()?.uid ?? '';
	}, email);
	expect(uid).toBeTruthy();
	return uid;
}

async function signOut(page: Page) {
	await page.evaluate(async () => {
		await window.signOutEmulatorUser?.();
	});
}

async function openCard(page: Page, caption: string) {
	await page.goto('/gallery', { waitUntil: 'domcontentloaded' });
	await page.getByTestId('gallery-search').fill(caption);
	await page.getByTestId('gallery-search').press('Enter');
	await expect(page.getByTestId('gallery-card')).toHaveCount(1, { timeout: 20_000 });
	const offer = page.waitForResponse((response) => response.url().includes('galleryBuddyOffer'));
	await page.getByTestId('gallery-card').click();
	await expect(page.getByTestId('gallery-lightbox')).toBeVisible();
	await offer;
}

async function addGalleryPhoto(page: Page, caption: string, bytes: Buffer) {
	await page.goto('/gallery', { waitUntil: 'domcontentloaded' });
	await page.getByTestId('add-photo').click();
	const dialog = page.getByTestId('add-photo-dialog');
	await expect(dialog).toBeVisible();
	await dialog.getByTestId('add-photo-file').setInputFiles({
		name: `${caption}.png`,
		mimeType: 'image/png',
		buffer: bytes
	});
	await dialog.getByTestId('add-photo-caption').fill(caption);
	await dialog.getByTestId('add-photo-type').selectOption('Performance Car');
	await dialog.getByTestId('add-photo-submit').click();
	await expect(page.getByText('Your photo is in the Gallery.')).toBeVisible({ timeout: 30_000 });
}

test('a gallery card can send, cancel, and accept a buddy request', async ({ page }) => {
	test.setTimeout(240_000);
	const stamp = Date.now().toString(36);
	const caption = `buddycar${stamp}`;
	const quiet = `quietcar${stamp}`;
	const ownerEmail = `buddy-owner-${stamp}@example.com`;
	const friendEmail = `buddy-friend-${stamp}@example.com`;
	const strangerEmail = `buddy-stranger-${stamp}@example.com`;

	await signIn(page, ownerEmail);
	await addGalleryPhoto(page, caption, TINY_PNG);
	await openCard(page, caption);
	await expect(page.getByTestId('add-buddy')).toHaveCount(0);

	await signOut(page);
	await openCard(page, caption);
	await expect(page.getByTestId('add-buddy')).toHaveText('Sign in to add as buddy');

	await signIn(page, friendEmail);
	await openCard(page, caption);
	await expect(page.getByTestId('add-buddy')).toHaveText('Add as buddy');
	await page.getByTestId('add-buddy').click();
	const dialog = page.getByTestId('add-buddy-dialog');
	await expect(dialog).toBeVisible();
	await dialog.getByTestId('add-buddy-message').fill('Nice paint');
	await dialog.getByTestId('add-buddy-send').click();
	await expect(page.getByTestId('add-buddy')).toHaveText('Request sent');
	await expect(page.getByTestId('add-buddy-cancel')).toBeVisible();
	await page.getByTestId('add-buddy-cancel').click();
	await expect(page.getByTestId('add-buddy')).toHaveText('Add as buddy');

	await page.getByTestId('add-buddy').click();
	await dialog.getByTestId('add-buddy-message').fill('Nice paint');
	await dialog.getByTestId('add-buddy-send').click();
	await expect(page.getByTestId('add-buddy')).toHaveText('Request sent');

	const photoId = (
		await emulatorFirestore().collection('sharedPhotos').where('caption', '==', caption).get()
	).docs[0]?.id;
	expect(photoId).toBeTruthy();
	await page.goto(`/car/${photoId}`, { waitUntil: 'domcontentloaded' });
	await expect(page.getByTestId('car-owner')).toBeVisible();
	await expect(page.getByTestId('add-buddy')).toHaveText('Request sent', { timeout: 20_000 });
	await page.goto(`/gallery?photo=${photoId}`, { waitUntil: 'domcontentloaded' });
	await expect(page.getByTestId('gallery-lightbox')).toBeVisible({ timeout: 20_000 });
	await expect(page.getByTestId('add-buddy')).toHaveText('Request sent');

	await signOut(page);
	await signIn(page, ownerEmail);
	await page.goto('/buddies', { waitUntil: 'domcontentloaded' });
	await expect(page.getByTestId('buddy-gallery-requests')).toBeChecked({ timeout: 20_000 });
	const incoming = page.getByTestId('buddy-incoming');
	await expect(incoming).toContainText('found you through your painted car: ' + caption);
	await expect(incoming.getByTestId('buddy-request-message')).toHaveText('Nice paint');
	await expect(incoming.getByTestId('buddy-gallery-thumb')).toBeVisible();
	await incoming.getByTestId('buddy-accept').click();
	await expect(page.getByText('You are now gaming buddies.')).toBeVisible();

	await signOut(page);
	await signIn(page, friendEmail);
	await openCard(page, caption);
	await expect(page.getByTestId('add-buddy')).toHaveText('Buddies ✓');

	await signOut(page);
	await signIn(page, ownerEmail);
	await page.goto('/buddies', { waitUntil: 'domcontentloaded' });
	await expect(page.getByTestId('buddy-gallery-requests')).toBeChecked({ timeout: 20_000 });
	await page.getByTestId('buddy-gallery-requests').uncheck();
	await page.getByTestId('buddy-save-profile').click();
	await expect(page.getByText('Your buddy name was saved.')).toBeVisible();
	await addGalleryPhoto(page, quiet, OTHER_PNG);

	await signOut(page);
	await signIn(page, strangerEmail);
	await openCard(page, quiet);
	await expect(page.getByTestId('add-buddy')).toHaveCount(0);
	const stored = (await emulatorFirestore().collection('sharedPhotos').where('caption', '==', quiet).get()).docs[0]?.data();
	expect(stored?.allowGalleryBuddies).toBe(false);
	expect(stored).not.toHaveProperty('ownerUid');
	expect(JSON.stringify(stored)).not.toContain(ownerEmail);
});
