export interface MarketingConsentFields {
	receiveUpdates?: boolean;
	receiveUpdatesChangedAt?: string;
}

/**
 * Record when marketing consent is turned on or off.
 * The first save of the default off state is not a change.
 * A timestamp supplied by the caller is kept only when the choice did not change.
 */
export function stampReceiveUpdatesConsent<T extends MarketingConsentFields>(
	previous: MarketingConsentFields | null | undefined,
	next: T,
	nowIso: string
): T {
	const prevOn = previous?.receiveUpdates === true;
	const nextOn = next.receiveUpdates === true;
	const changed = previous ? prevOn !== nextOn : nextOn;
	if (changed) return { ...next, receiveUpdatesChangedAt: nowIso };

	if (previous && typeof previous.receiveUpdatesChangedAt === 'string' && previous.receiveUpdatesChangedAt) {
		return { ...next, receiveUpdatesChangedAt: previous.receiveUpdatesChangedAt };
	}

	if (!Object.prototype.hasOwnProperty.call(next, 'receiveUpdatesChangedAt')) return next;
	const copy = { ...next };
	delete copy.receiveUpdatesChangedAt;
	return copy;
}
