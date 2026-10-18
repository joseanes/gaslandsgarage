export type ConsentChoiceView =
	| { stored: false }
	| { stored: true; choice: 'accepted' | 'rejected'; at: string; gpc: boolean };

export type SmsView = { collected: false } | { collected: true; optIn: boolean; at: string | null };

/** Fields an administrator may see. Builder and print preferences are left out. */
export type AdminAccountSettings = {
	newsletterOptIn: boolean | null;
	newsletterOptInAt: string | null;
	newsletterOptOutAt: string | null;
	newsletterConsentText: string | null;
	allowContactFromPlayers: boolean;
	showOnPlayersMap: boolean;
	location: string;
	analytics: ConsentChoiceView;
	ads: ConsentChoiceView;
	gpc: boolean | null;
	sms: SmsView;
};

/** City and map visibility. Coordinates, bio, and the pin id are not included. */
export type AdminProfileView = {
	city: string;
	showOnMap: boolean;
	anonymousOnMap: boolean;
	openToGames: boolean;
	playerName: string;
};

const SMS_FIELDS = ['smsOptIn', 'receiveSms', 'textOptIn', 'smsConsent'] as const;

function text(value: unknown): string | null {
	return typeof value === 'string' && value ? value : null;
}

function readChoice(value: unknown): ConsentChoiceView | null {
	if (!value || typeof value !== 'object') return null;
	const record = value as Record<string, unknown>;
	if (record.choice !== 'accepted' && record.choice !== 'rejected') return null;
	return {
		stored: true,
		choice: record.choice,
		at: typeof record.at === 'string' ? record.at : '',
		gpc: record.gpc === true
	};
}

function readSms(data: Record<string, unknown>): SmsView {
	for (const key of SMS_FIELDS) {
		const value = data[key];
		if (typeof value === 'boolean') return { collected: true, optIn: value, at: null };
		if (value && typeof value === 'object') {
			const record = value as Record<string, unknown>;
			if (typeof record.optIn === 'boolean') {
				return {
					collected: true,
					optIn: record.optIn,
					at: typeof record.at === 'string' ? record.at : null
				};
			}
		}
	}
	return { collected: false };
}

export function projectUserSettings(data: Record<string, unknown> | undefined): AdminAccountSettings {
	const source = data ?? {};
	return {
		newsletterOptIn: typeof source.newsletterOptIn === 'boolean' ? source.newsletterOptIn : null,
		newsletterOptInAt: text(source.newsletterOptInAt),
		newsletterOptOutAt: text(source.newsletterOptOutAt),
		newsletterConsentText: text(source.newsletterConsentText),
		allowContactFromPlayers: source.allowContactFromPlayers === true,
		showOnPlayersMap: source.showOnPlayersMap === true,
		location: typeof source.location === 'string' ? source.location : '',
		analytics: readChoice(source.analyticsConsent) ?? readChoice(source.analyticsChoice) ?? { stored: false },
		ads: readChoice(source.adsConsent) ?? readChoice(source.adConsent) ?? { stored: false },
		gpc: typeof source.gpc === 'boolean' ? source.gpc : typeof source.globalPrivacyControl === 'boolean' ? source.globalPrivacyControl : null,
		sms: readSms(source)
	};
}

export function projectPlayerProfile(data: Record<string, unknown> | undefined): AdminProfileView | null {
	if (!data) return null;
	const label = (key: string) => (typeof data[key] === 'string' ? (data[key] as string) : '');
	return {
		city: label('locationLabel'),
		showOnMap: data.showOnMap === true,
		anonymousOnMap: data.anonymousOnMap === true,
		openToGames: data.openToGames === true,
		playerName: label('playerName')
	};
}

export function profileVisibility(profile: AdminProfileView): string {
	if (!profile.showOnMap) return 'Hidden';
	if (profile.anonymousOnMap) return 'On the map, anonymous';
	return profile.playerName ? `On the map as ${profile.playerName}` : 'On the map';
}
