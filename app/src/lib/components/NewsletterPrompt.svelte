<script lang="ts">
	import { user } from '$lib/firebase';
	import { NEWSLETTER_CONSENT_COPY } from '$lib/privacy/marketingConsent';
	import {
		dismissNewsletterPrompt,
		getUserSettings,
		newsletterView,
		resetNewsletterView,
		saveNewsletterChoice
	} from '$lib/services/settings';

	let busy = false;
	let seenUid = '';

	$: if (($user?.uid ?? '') !== seenUid) {
		seenUid = $user?.uid ?? '';
		resetNewsletterView();
		if (seenUid) void getUserSettings();
	}

	$: show =
		!!$user &&
		$newsletterView.loaded &&
		!$newsletterView.answered &&
		!$newsletterView.dismissed;

	async function accept() {
		if (busy) return;
		busy = true;
		await saveNewsletterChoice(true);
		busy = false;
	}

	async function dismiss() {
		if (busy) return;
		busy = true;
		await dismissNewsletterPrompt();
		busy = false;
	}
</script>

{#if show}
	<div
		class="print:hidden my-4 rounded-lg border border-stone-200 bg-stone-50 px-3 py-3 text-sm text-stone-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
		data-testid="newsletter-prompt"
		role="region"
		aria-label="Monthly email"
	>
		<p>{NEWSLETTER_CONSENT_COPY}</p>
		<div class="mt-3 flex flex-wrap gap-2">
			<button
				type="button"
				class="rounded-lg border border-stone-400 px-3 py-2 text-stone-800 disabled:opacity-60 dark:border-gray-500 dark:text-gray-100"
				data-testid="newsletter-accept"
				disabled={busy}
				on:click={accept}
			>
				Send me the monthly email
			</button>
			<button
				type="button"
				class="rounded-lg border border-stone-400 px-3 py-2 text-stone-800 disabled:opacity-60 dark:border-gray-500 dark:text-gray-100"
				data-testid="newsletter-dismiss"
				disabled={busy}
				on:click={dismiss}
			>
				No thanks
			</button>
		</div>
	</div>
{/if}
