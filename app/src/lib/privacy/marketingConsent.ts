export interface MarketingConsentFields {
	receiveUpdates?: boolean;
	receiveUpdatesChangedAt?: string;
}

/** Version stored in `userSettings.newsletterConsentText` for the monthly email. */
export const NEWSLETTER_CONSENT_VERSION = 'monthly-email-v1';

/** The label shown next to the unchecked monthly-email checkbox. */
export const NEWSLETTER_CONSENT_COPY =
	'Send me the monthly Gaslands Garage email: game tips, car suggestions, and new site features. About once a month. Unsubscribe anytime.';

/** Where the player last recorded the monthly-email choice. */
export type NewsletterSource = 'profile' | 'prompt' | 'settings';

export interface NewsletterConsentFields {
	newsletterOptIn?: boolean;
	newsletterOptInAt?: string;
	newsletterOptOutAt?: string;
	newsletterConsentText?: string;
	newsletterPromptDismissedAt?: string;
	newsletterSource?: string;
}

const NEWSLETTER_KEYS = [
	'newsletterOptIn',
	'newsletterOptInAt',
	'newsletterOptOutAt',
	'newsletterConsentText',
	'newsletterPromptDismissedAt',
	'newsletterSource'
] as const;

function withoutNewsletter<T extends object>(value: T): T {
	const copy = { ...value } as T & Record<string, unknown>;
	for (const key of NEWSLETTER_KEYS) delete copy[key];
	return copy;
}

function keptString(value: unknown): string | undefined {
	return typeof value === 'string' && value ? value : undefined;
}

function keptSource(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 && value.length < 40 ? value : undefined;
}

/** Keep a recorded source. A new choice without a source does not keep the old one. */
function sourceFor(choice: NewsletterConsentFields, prev: NewsletterConsentFields): string | undefined {
	if (Object.prototype.hasOwnProperty.call(choice, 'newsletterSource')) return keptSource(choice.newsletterSource);
	const sameChoice =
		!Object.prototype.hasOwnProperty.call(choice, 'newsletterOptIn') || choice.newsletterOptIn === prev.newsletterOptIn;
	return sameChoice ? keptSource(prev.newsletterSource) : undefined;
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

	const source = sourceFor(choice, prev);
	const sourced = source ? { newsletterSource: source } : {};

	if (!Object.prototype.hasOwnProperty.call(choice, 'newsletterOptIn')) {
		const kept: NewsletterConsentFields = { ...keptDismiss, ...sourced };
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
			...sourced,
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
		...sourced,
		...(optInAt ? { newsletterOptInAt: optInAt } : {}),
		newsletterOptIn: false,
		newsletterOptOutAt: previousOptOutAt ?? nowIso,
		newsletterConsentText: keptString(prev.newsletterConsentText) ?? NEWSLETTER_CONSENT_VERSION
	};
}

const RETIRED_UPDATE_KEYS = ['receiveUpdates', 'receiveUpdatesChangedAt'] as const;

/**
 * "Keep me up to date" is retired. A save cannot turn that choice on or off,
 * and it cannot copy the old choice onto the monthly email.
 * A value already stored on the account is written back unchanged.
 */
export function preserveStoredReceiveUpdates<T extends object>(
	previous: MarketingConsentFields | null | undefined,
	next: T
): T & MarketingConsentFields {
	const copy: Record<string, unknown> = { ...(next as Record<string, unknown>) };
	for (const key of RETIRED_UPDATE_KEYS) delete copy[key];
	const prev = (previous ?? {}) as Record<string, unknown>;
	for (const key of RETIRED_UPDATE_KEYS) {
		if (!Object.prototype.hasOwnProperty.call(prev, key)) continue;
		if (prev[key] !== undefined) copy[key] = prev[key];
	}
	return copy as T & MarketingConsentFields;
}
