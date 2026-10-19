import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	DRAFT_STORAGE_KEY,
	EMAIL_INVITE_STORAGE_KEY,
	redactAnalyticsPayload,
	stashSensitiveSearch
} from './analyticsUrl';

describe('analytics URL scrub', () => {
	it('moves the invite token and the draft out of the query before a page view', () => {
		const stored = new Map<string, string>();
		const storage = { setItem: (key: string, value: string) => stored.set(key, value) };
		const token = 'invite-token-value';
		const next = stashSensitiveSearch(
			`https://gaslandsgarage.com/buddies?emailInvite=${encodeURIComponent(token)}&invite=ABCDEF`,
			storage
		);
		expect(next).toBe('/buddies?invite=ABCDEF');
		expect(next).not.toContain(token);
		expect(stored.get(EMAIL_INVITE_STORAGE_KEY)).toBe(token);
		expect(new URL(`https://gaslandsgarage.com${next}`).search).not.toContain('emailInvite');
	});

	it('stashes a shared draft and redacts it from an analytics payload', () => {
		const stored = new Map<string, string>();
		const storage = { setItem: (key: string, value: string) => stored.set(key, value) };
		const next = stashSensitiveSearch('https://gaslandsgarage.com/builder?draft=abc123&x=1', storage);
		expect(next).toBe('/builder?x=1');
		expect(stored.get(DRAFT_STORAGE_KEY)).toBe('abc123');
		const hit = 'https://www.google-analytics.com/g/collect?dl=https%3A%2F%2Fgaslandsgarage.com%2Fbuilder%3Fdraft%3Dabc123&tid=G';
		const redacted = redactAnalyticsPayload(hit);
		expect(redacted).not.toContain('abc123');
		expect(redacted).toContain('draft%3D(redacted)');
	});
});

describe('app.html analytics order', () => {
	const html = readFileSync(path.resolve(process.cwd(), 'src/app.html'), 'utf8');

	it('stashes secrets and sets a query-free page_location before gtag config', () => {
		const stashAt = html.indexOf('gaslands.emailInvite');
		const configAt = html.indexOf("gtag('config', 'G-EKPMXMY097'");
		const srcAt = html.indexOf('https://www.googletagmanager.com/gtag/js?id=G-EKPMXMY097');
		expect(stashAt).toBeGreaterThan(-1);
		expect(configAt).toBeGreaterThan(stashAt);
		expect(srcAt).toBeGreaterThan(stashAt);
		expect(html).toContain('page_location: location.origin + location.pathname');
		expect(html).toContain('gaslands.pendingDraft');
		expect(html).toContain('sendBeacon');
	});
});
