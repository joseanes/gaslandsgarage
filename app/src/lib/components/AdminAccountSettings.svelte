<script lang="ts">
	import {
		profileVisibility,
		type AdminAccountSettings,
		type AdminProfileView,
		type ConsentChoiceView
	} from '$lib/admin/accountSettings';
	import type { DirectoryUser } from '$lib/admin/api';

	export let person: DirectoryUser;
	export let settings: AdminAccountSettings | null;
	export let profile: AdminProfileView | null;
	export let profileLoaded: boolean;
	export let loading = false;
	export let loadError = '';

	function formatWhen(value: string | null): string {
		if (!value) return 'Not recorded';
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) return value;
		return parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	}

	function onOff(value: boolean): string {
		return value ? 'On' : 'Off';
	}

	function choiceText(choice: ConsentChoiceView, absent: string): string {
		if (!choice.stored) return absent;
		const when = choice.at ? ` · ${formatWhen(choice.at)}` : '';
		const signal = choice.gpc ? ' · Global Privacy Control was on' : '';
		return `${choice.choice === 'accepted' ? 'Accepted' : 'Rejected'}${when}${signal}`;
	}

	$: label = person.email || person.displayName || person.uid;
	$: visibility = profile ? profileVisibility(profile) : '';
</script>

<section class="rounded-lg border border-stone-200 p-4 dark:border-gray-700" data-testid="admin-user-settings" aria-label={`Settings for ${label}`}>
	<h2 class="text-xl font-bold">Settings for {label}</h2>
	<p class="mt-1 text-sm text-stone-600 dark:text-gray-300">
		Read-only. An administrator cannot change these choices.
	</p>

	{#if loading}
		<p class="mt-4" data-testid="settings-loading">Loading settings</p>
	{:else if loadError}
		<p class="mt-4" role="alert" data-testid="settings-error">{loadError}</p>
	{:else}
	<dl class="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[12rem_1fr]">
		<dt class="font-medium">Account status</dt>
		<dd data-testid="account-status">{person.disabled ? 'Disabled' : 'Active'}</dd>

		<dt class="font-medium">Created</dt>
		<dd data-testid="account-created">{formatWhen(person.createdAt)}</dd>

		<dt class="font-medium">Last sign-in</dt>
		<dd data-testid="account-last-sign-in">{formatWhen(person.lastSignInAt)}</dd>

		{#if settings}
			<dt class="font-medium">Monthly email</dt>
			<dd data-testid="newsletter-status">
				{#if settings.newsletterOptIn === true}
					On
				{:else if settings.newsletterOptIn === false}
					Off
				{:else}
					Not answered
				{/if}
			</dd>

			<dt class="font-medium">Monthly email given</dt>
			<dd data-testid="newsletter-given">
				{#if settings.newsletterOptIn === true}
					Opted in {formatWhen(settings.newsletterOptInAt)}
					{#if settings.newsletterConsentText}
						<span class="text-stone-500"> ({settings.newsletterConsentText})</span>
					{/if}
				{:else if settings.newsletterOptIn === false}
					Opted out {formatWhen(settings.newsletterOptOutAt)}
					{#if settings.newsletterOptInAt}
						<span class="block text-stone-500">Previously opted in {formatWhen(settings.newsletterOptInAt)}</span>
					{/if}
				{:else}
					Not answered
				{/if}
			</dd>

			<dt class="font-medium">Game-request email</dt>
			<dd data-testid="game-request-email">{onOff(settings.allowContactFromPlayers)}</dd>

			<dt class="font-medium">Analytics consent</dt>
			<dd data-testid="analytics-consent">{choiceText(settings.analytics, 'Not stored on the account')}</dd>

			<dt class="font-medium">Ads consent</dt>
			<dd data-testid="ads-consent">
				{choiceText(settings.ads, 'Denied. Not stored on the account. Ad storage, ad user data, and ad personalization stay off.')}
			</dd>

			<dt class="font-medium">Global Privacy Control</dt>
			<dd data-testid="gpc-status">
				{#if settings.gpc === null}
					Honored in the browser. Not stored on the account.
				{:else}
					{settings.gpc ? 'On' : 'Off'} on the account.
				{/if}
				{#if settings.analytics.stored && settings.analytics.gpc}
					The stored analytics choice was made while Global Privacy Control was on.
				{/if}
			</dd>

			<dt class="font-medium">SMS or text</dt>
			<dd data-testid="sms-opt-in">
				{#if !settings.sms.collected}
					Not collected
				{:else}
					{onOff(settings.sms.optIn)}
					{#if settings.sms.at}
						<span class="text-stone-500"> · {formatWhen(settings.sms.at)}</span>
					{/if}
				{/if}
			</dd>

			<dt class="font-medium">Settings map preference</dt>
			<dd data-testid="settings-map">{onOff(settings.showOnPlayersMap)}</dd>

			<dt class="font-medium">Location in settings</dt>
			<dd data-testid="settings-location">{settings.location || 'None saved'}</dd>
		{:else}
			<dt class="font-medium">Account settings</dt>
			<dd role="alert" data-testid="settings-unavailable">Account settings could not be loaded.</dd>
		{/if}

		<dt class="font-medium">Profile city</dt>
		<dd data-testid="profile-city">
			{#if !profileLoaded}
				Player profile could not be loaded.
			{:else if !profile}
				No player profile
			{:else}
				{profile.city || 'No city saved'}
			{/if}
		</dd>

		<dt class="font-medium">Players map</dt>
		<dd data-testid="profile-visibility">
			{#if !profileLoaded}
				Player profile could not be loaded.
			{:else if !profile}
				No player profile
			{:else}
				{visibility}
			{/if}
		</dd>

		<dt class="font-medium">Open to games</dt>
		<dd data-testid="profile-open-to-games">
			{#if !profileLoaded}
				Player profile could not be loaded.
			{:else if !profile}
				No player profile
			{:else}
				{profile.openToGames ? 'Yes' : 'No'}
			{/if}
		</dd>
	</dl>
	{/if}
</section>
