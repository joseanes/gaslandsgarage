import { describe, expect, it } from 'vitest';
import { DEFAULT_RETAIN_MS, keysToPrune } from '../../../../scripts/retain-hashed-assets.mjs';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-10-18T22:00:00Z');

describe('keysToPrune', () => {
	it('keeps the current build and recent replaced hashes', () => {
		const current = ['_app/immutable/chunks/new.js'];
		const remote = [
			{ key: '_app/immutable/chunks/new.js', lastModified: now - 40 * DAY },
			{ key: '_app/immutable/chunks/yesterday.js', lastModified: now - DAY },
			{ key: '_app/immutable/chunks/old.js', lastModified: now - 15 * DAY },
			{ key: 'index.html', lastModified: now - 40 * DAY }
		];

		expect(keysToPrune(remote, current, now, DEFAULT_RETAIN_MS)).toEqual([
			'_app/immutable/chunks/old.js'
		]);
	});

	it('keeps an object whose timestamp cannot be read', () => {
		expect(keysToPrune(
			[{ key: '_app/immutable/chunks/odd.js', lastModified: 'not-a-date' }],
			[],
			now
		)).toEqual([]);
	});
});
