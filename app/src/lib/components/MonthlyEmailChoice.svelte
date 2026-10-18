<script lang="ts">
	import { NEWSLETTER_CONSENT_COPY } from '$lib/privacy/marketingConsent';
	import { newsletterView, saveNewsletterChoice } from '$lib/services/settings';

	let busy = false;
	let error = '';

	function formatWhen(value: string): string {
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) return value;
		return parsed.toLocaleDateString(undefined, { dateStyle: 'medium' });
	}

	$: subscribed = $newsletterView.optIn;
	$: status = !$newsletterView.loaded
		? 'Loading…'
		: subscribed && $newsletterView.optInAt
			? `Subscribed since ${formatWhen($newsletterView.optInAt)}`
			: subscribed
				? 'Subscribed'
				: 'Not subscribed';

	async function choose(optIn: boolean) {
		if (busy || !$newsletterView.loaded || optIn === subscribed) return;
		busy = true;
		error = '';
		const result = await saveNewsletterChoice(optIn, 'profile');
		busy = false;
		if (!result.success) error = 'Could not save that choice. Try again.';
	}

	function onToggle(event: Event) {
		const input = event.currentTarget;
		if (!(input instanceof HTMLInputElement)) return;
		void choose(input.checked);
	}
</script>

<section
	class="mb-6 rounded-lg border border-stone-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
	data-testid="profile-newsletter"
	aria-labelledby="monthly-email-heading"
>
	<h2 id="monthly-email-heading" class="text-xl font-bold">Monthly Gaslands Garage email</h2>
	<p class="mt-1 text-sm text-stone-600 dark:text-gray-300" data-testid="profile-newsletter-status">{status}</p>
	<p class="mt-2 text-sm text-stone-600 dark:text-gray-300">
		It saves as soon as you change it.
	</p>
	<label class="mt-3 flex items-start gap-2">
		<input
			type="checkbox"
			class="mt-1 h-5 w-5 shrink-0"
			data-testid="profile-newsletter-opt-in"
			checked={subscribed}
			disabled={busy || !$newsletterView.loaded}
			on:change={onToggle}
		/>
		<span>{NEWSLETTER_CONSENT_COPY}</span>
	</label>
	<button
		type="button"
		class="amber-button mt-3 rounded-lg px-4"
		data-testid="profile-newsletter-toggle"
		disabled={busy || !$newsletterView.loaded}
		aria-pressed={subscribed}
		on:click={() => choose(!subscribed)}
	>
		{busy ? 'Saving…' : subscribed ? 'Unsubscribe' : 'Subscribe'}
	</button>
	{#if error}
		<p role="alert" class="mt-2 text-red-700 dark:text-red-300">{error}</p>
	{/if}
</section>
