<script lang="ts">
	import { user } from '$lib/firebase';
	import { galleryBuddyLabel } from '$lib/buddies/gallery';
	import {
		buddyErrorMessage,
		cancelBuddyRequest,
		galleryBuddyOffer,
		respondBuddyRequest,
		sendBuddyRequest,
		type GalleryBuddyOffer
	} from '$lib/services/buddies';

	export let photoId: string;

	let offer: GalleryBuddyOffer['offer'] | 'loading' = 'loading';
	let requestId = '';
	let confirm = false;
	let message = '';
	let busy = false;
	let error = '';
	let ticket = 0;

	async function refresh(id: string, _viewer: string) {
		const current = ++ticket;
		offer = 'loading';
		error = '';
		try {
			const result = await galleryBuddyOffer(id);
			if (current !== ticket) return;
			offer = result.offer;
			requestId = result.requestId;
		} catch {
			if (current !== ticket) return;
			offer = 'hidden';
			requestId = '';
		}
	}

	function requestSignIn() {
		window.dispatchEvent(new CustomEvent('gaslands-request-sign-in'));
	}

	async function send() {
		busy = true;
		error = '';
		try {
			await sendBuddyRequest({ photoId, message });
			confirm = false;
			message = '';
			await refresh(photoId, $user?.uid ?? '');
		} catch (cause) {
			error = buddyErrorMessage(cause);
		} finally {
			busy = false;
		}
	}

	async function cancel() {
		if (!requestId) return;
		busy = true;
		error = '';
		try {
			await cancelBuddyRequest(requestId);
			await refresh(photoId, $user?.uid ?? '');
		} catch (cause) {
			error = buddyErrorMessage(cause);
		} finally {
			busy = false;
		}
	}

	async function accept() {
		if (!requestId) return;
		busy = true;
		error = '';
		try {
			await respondBuddyRequest(requestId, 'accept');
			await refresh(photoId, $user?.uid ?? '');
		} catch (cause) {
			error = buddyErrorMessage(cause);
		} finally {
			busy = false;
		}
	}

	$: void refresh(photoId, $user?.uid ?? '');
	$: label = galleryBuddyLabel(offer);
</script>

{#if offer === 'sign-in'}
	<button type="button" class="rounded-md px-3 py-2 text-sm amber-button" data-testid="add-buddy" on:click={requestSignIn}>
		{label}
	</button>
{:else if offer === 'add'}
	<button type="button" class="rounded-md px-3 py-2 text-sm amber-button" data-testid="add-buddy" disabled={busy} on:click={() => (confirm = true)}>
		{label}
	</button>
{:else if offer === 'sent'}
	<span class="inline-flex min-h-11 items-center text-sm font-medium" data-testid="add-buddy">{label}</span>
	<button type="button" class="rounded-md border border-current px-3 py-2 text-sm" data-testid="add-buddy-cancel" disabled={busy} on:click={cancel}>
		Cancel
	</button>
{:else if offer === 'buddies'}
	<span class="inline-flex min-h-11 items-center text-sm font-medium" data-testid="add-buddy">{label}</span>
{:else if offer === 'accept'}
	<button type="button" class="rounded-md px-3 py-2 text-sm amber-button" data-testid="add-buddy" disabled={busy} on:click={accept}>
		{label}
	</button>
{:else if offer === 'declined'}
	<button type="button" class="rounded-md px-3 py-2 text-sm opacity-70" data-testid="add-buddy" disabled>{label}</button>
{/if}
{#if error}
	<p class="mt-2 text-sm" role="alert" data-testid="add-buddy-error">{error}</p>
{/if}

{#if confirm}
	<div class="fixed inset-0 z-[60] flex items-end justify-center bg-stone-950/80 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label="Add as buddy" data-testid="add-buddy-dialog">
		<form class="w-full max-w-md rounded-xl border border-orange-900/60 bg-stone-950 p-4 text-orange-50" on:submit|preventDefault={send}>
			<h2 class="text-lg font-bold">Add as buddy</h2>
			<p class="mt-2 text-sm text-orange-100/80">Send a buddy request. They can accept or decline it from Gaming Buddies.</p>
			<label class="mt-3 block text-sm font-medium" for="add-buddy-message">Note, optional</label>
			<textarea
				id="add-buddy-message"
				class="mt-1 w-full rounded-md border border-orange-900 bg-stone-900 px-3 py-2 text-sm text-orange-50"
				maxlength="200"
				rows="3"
				bind:value={message}
				data-testid="add-buddy-message"
			></textarea>
			<p class="mt-1 text-xs text-orange-100/70">{message.trim().length}/200</p>
			<div class="mt-3 flex flex-wrap gap-2">
				<button type="submit" class="rounded-md px-3 py-2 text-sm amber-button" data-testid="add-buddy-send" disabled={busy}>Send request</button>
				<button type="button" class="rounded-md border border-orange-800 px-3 py-2 text-sm" disabled={busy} on:click={() => (confirm = false)}>
					Cancel
				</button>
			</div>
			{#if error}
				<p class="mt-2 text-sm" role="alert">{error}</p>
			{/if}
		</form>
	</div>
{/if}
