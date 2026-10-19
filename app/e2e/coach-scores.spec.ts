import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const shots = '/opt/cursor/artifacts/screenshots';

function draftUrl(draft: unknown): string {
	const encoded = Buffer.from(encodeURIComponent(JSON.stringify(draft)), 'utf8').toString('base64');
	return `/builder?draft=${encodeURIComponent(encoded)}`;
}

const weakTeam = {
	sponsor: 'no_sponsor',
	maxCans: 50,
	rulesVersion: 2,
	teamName: 'Weak',
	vehicles: [
		{
			id: 'weak01',
			type: 'heavy_truck',
			name: 'Lugger',
			weapons: [],
			upgrades: [],
			perks: []
		}
	]
};

const strongTeam = {
	sponsor: 'no_sponsor',
	maxCans: 50,
	rulesVersion: 2,
	teamName: 'Strong',
	vehicles: ['a', 'b', 'c'].map((id) => ({
		id: `bug${id}`,
		type: 'buggy',
		name: `Runner ${id.toUpperCase()}`,
		weapons: [`minigun_${id}1`, `hmg_${id}1`],
		upgrades: [],
		perks: []
	}))
};

async function openTeam(page: Page, draft: unknown) {
	await page.addInitScript(() => {
		localStorage.setItem('gaslands-consent', 'rejected');
	});
	await page.goto(draftUrl(draft), { waitUntil: 'domcontentloaded' });
	const consent = page.getByTestId('consent-reject');
	if (await consent.isVisible().catch(() => false)) await consent.click();
	const coach = page.getByTestId('coach-panel');
	await expect(coach).toBeVisible({ timeout: 30_000 });
	await expect(page.getByTestId('coach-lead')).toContainText('No rules issues');
	const details = page.getByRole('button', { name: 'Show details' });
	if (await details.isVisible()) await details.click();
	await expect(page.getByTestId('coach-status-combat')).toBeVisible();
	return coach;
}

async function shoot(page: Page, name: string) {
	fs.mkdirSync(shots, { recursive: true });
	const coach = page.getByTestId('coach-panel');
	await page.setViewportSize({ width: 1280, height: 900 });
	await coach.scrollIntoViewIfNeeded();
	await coach.screenshot({ path: `${shots}/${name}-desktop.png` });
	await page.evaluate(() => document.documentElement.classList.add('dark', 'dark-mode'));
	await coach.screenshot({ path: `${shots}/${name}-desktop-dark.png` });
	await page.evaluate(() => document.documentElement.classList.remove('dark', 'dark-mode'));
	await page.setViewportSize({ width: 375, height: 812 });
	await coach.scrollIntoViewIfNeeded();
	await coach.screenshot({ path: `${shots}/${name}-mobile.png` });
	await page.evaluate(() => document.documentElement.classList.add('dark', 'dark-mode'));
	await coach.screenshot({ path: `${shots}/${name}-mobile-dark.png` });
	await page.evaluate(() => document.documentElement.classList.remove('dark', 'dark-mode'));
}

test('coach colors a weak team and a strong team', async ({ page }) => {
	test.setTimeout(120_000);
	page.on('dialog', (dialog) => dialog.accept());

	await openTeam(page, weakTeam);
	await expect(page.getByTestId('coach-cans')).toContainText('25 / 50');
	await expect(page.getByTestId('coach-cans')).toContainText('25 left');
	await expect(page.getByTestId('coach-status-combat')).toHaveText('Low');
	await expect(page.getByTestId('coach-status-mobility')).toHaveText('Low');
	await expect(page.getByTestId('coach-status-slots')).toHaveText('Low');
	await expect(page.getByTestId('coach-status-survivability')).toHaveText('Average');
	await expect(page.getByTestId('coach-typical')).toContainText('50-can list');
	await expect(page.getByTestId('coach-next-vehicle')).toContainText('Mobility 2.6');
	await expect(page.getByTestId('coach-next-vehicle')).toContainText('flanker');
	await expect(page.getByTestId('coach-suggestions')).toContainText('You have 25 cans left of 50.');
	await expect(page.getByTestId('coach-suggestions')).toContainText('Heavy Machine Gun');
	await shoot(page, 'coach-weak');

	await openTeam(page, strongTeam);
	await expect(page.getByTestId('coach-cans')).toContainText('42 / 50');
	await expect(page.getByTestId('coach-status-combat')).toHaveText('Strong');
	await expect(page.getByTestId('coach-status-mobility')).toHaveText('Strong');
	await expect(page.getByTestId('coach-status-slots')).toHaveText('Strong');
	await expect(page.getByTestId('coach-status-survivability')).toHaveText('Average');
	await expect(page.getByTestId('coach-analysis-combat')).toHaveText('0.50');
	await shoot(page, 'coach-strong');
});
