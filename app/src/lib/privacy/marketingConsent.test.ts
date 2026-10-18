import { describe, expect, it } from 'vitest';
import { stampReceiveUpdatesConsent } from './marketingConsent';

const now = '2026-10-18T12:00:00.000Z';

describe('receiveUpdates consent timestamp', () => {
	it('stamps a change on or off and leaves an unchanged choice alone', () => {
		expect(stampReceiveUpdatesConsent(null, { receiveUpdates: false, darkMode: true }, now)).toEqual({
			receiveUpdates: false,
			darkMode: true
		});
		expect(stampReceiveUpdatesConsent(null, { receiveUpdates: true }, now)).toEqual({
			receiveUpdates: true,
			receiveUpdatesChangedAt: now
		});
		expect(stampReceiveUpdatesConsent({ receiveUpdates: false }, { receiveUpdates: true, darkMode: false }, now)).toEqual({
			receiveUpdates: true,
			darkMode: false,
			receiveUpdatesChangedAt: now
		});
		expect(
			stampReceiveUpdatesConsent(
				{ receiveUpdates: true, receiveUpdatesChangedAt: '2026-01-01T00:00:00.000Z' },
				{ receiveUpdates: false },
				now
			)
		).toEqual({ receiveUpdates: false, receiveUpdatesChangedAt: now });
		expect(
			stampReceiveUpdatesConsent(
				{ receiveUpdates: true, receiveUpdatesChangedAt: '2026-01-01T00:00:00.000Z' },
				{ receiveUpdates: true, receiveUpdatesChangedAt: '2099-01-01T00:00:00.000Z' },
				now
			)
		).toEqual({ receiveUpdates: true, receiveUpdatesChangedAt: '2026-01-01T00:00:00.000Z' });
	});

	it('drops a caller-supplied timestamp when the choice never changed', () => {
		expect(
			stampReceiveUpdatesConsent({ receiveUpdates: false }, { receiveUpdates: false, receiveUpdatesChangedAt: now }, now)
		).toEqual({ receiveUpdates: false });
	});
});
