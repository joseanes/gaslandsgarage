export interface MarketingConsentFields {
	receiveUpdates?: boolean;
	receiveUpdatesChangedAt?: string;
}

/** Version stored in `userSettings.newsletterConsentText` for the monthly email. */
export const NEWSLETTER_CONSENT_VERSION = 'monthly-email-v1';

/** The label shown next to the unchecked monthly-email checkbox. */
export const NEWSLETTER_CONSENT_COPY =
	'Send me the monthly Gaslands Garage email: game tips, car suggestions, and new site features. About once a month. Unsubscribe anytime.';

export interface NewsletterConsentFields {
	newsletterOptIn?: boolean;
	newsletterOptInAt?: string;
	newsletterOptOutAt?: string;
	newsletterConsentText?: string;
	newsletterPromptDismissedAt?: string;
}

const NEWSLETTER_KEYS = [
	'newsletterOptIn',
	'newsletterOptInAt',
	'newsletterOptOutAt',
	'newsletterConsentText',
	'newsletterPromptDismissedAt'
] as const;

function withoutNewsletter<T extends object>(value: T): T {
	const copy = { ...value } as T & Record<string, unknown>;
	for (const key of NEWSLETTER_KEYS) delete copy[key];
	return copy;
}

function keptString(value: unknown): string | undefined {
	return typeof value === 'string' && value ? value : undefined;
}

/**
 * Record an explicit monthly-email choice.
 * A save that leaves `newsletterOptIn` out does not answer and does not erase a previous choice.
 * Opting in stamps `newsletterOptInAt` and the consent version. Opting out stamps `newsletterOptOutAt`.
 * A repeated save of the same choice keeps the earlier timestamp.
 */
export function stampNewsletterConsent<T extends object>(
	previous: NewsletterConsentFields | null | undefined,
	next: T,
	nowIso: string
): T & NewsletterConsentFields {
	const prev = previous ?? {};
	const choice = next as T & NewsletterConsentFields;
	const rest = withoutNewsletter(choice);
	const dismissed = keptString(prev.newsletterPromptDismissedAt);
	const keptDismiss = dismissed ? { newsletterPromptDismissedAt: dismissed } : {};

	if (!Object.prototype.hasOwnProperty.call(choice, 'newsletterOptIn')) {
		const kept: NewsletterConsentFields = { ...keptDismiss };
		if (typeof prev.newsletterOptIn === 'boolean') kept.newsletterOptIn = prev.newsletterOptIn;
		const optInAt = keptString(prev.newsletterOptInAt);
		const optOutAt = keptString(prev.newsletterOptOutAt);
		const consent = keptString(prev.newsletterConsentText);
		if (optInAt) kept.newsletterOptInAt = optInAt;
		if (optOutAt) kept.newsletterOptOutAt = optOutAt;
		if (consent) kept.newsletterConsentText = consent;
		return { ...rest, ...kept };
	}

	if (choice.newsletterOptIn === true) {
		const previousOptInAt = prev.newsletterOptIn === true ? keptString(prev.newsletterOptInAt) : undefined;
		const optOutAt = keptString(prev.newsletterOptOutAt);
		return {
			...rest,
			...keptDismiss,
			...(optOutAt ? { newsletterOptOutAt: optOutAt } : {}),
			newsletterOptIn: true,
			newsletterOptInAt: previousOptInAt ?? nowIso,
			newsletterConsentText: NEWSLETTER_CONSENT_VERSION
		};
	}

	const previousOptOutAt = prev.newsletterOptIn === false ? keptString(prev.newsletterOptOutAt) : undefined;
	const optInAt = keptString(prev.newsletterOptInAt);
	return {
		...rest,
		...keptDismiss,
		...(optInAt ? { newsletterOptInAt: optInAt } : {}),
		newsletterOptIn: false,
		newsletterOptOutAt: previousOptOutAt ?? nowIso,
		newsletterConsentText: keptString(prev.newsletterConsentText) ?? NEWSLETTER_CONSENT_VERSION
	};
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
