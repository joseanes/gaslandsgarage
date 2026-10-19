<script lang="ts">
	import { onDestroy } from 'svelte';
	import { user } from '$lib/firebase';
	import { accountSessionReady, isAdministrator } from '$lib/admin/session';
	import {
		adminPhotoObjectUrl,
		loadModeration,
		moderatePhoto,
		type ModerationPhoto
	} from '$lib/services/photoShare';

	let status: 'loading' | 'signed-out' | 'forbidden' | 'ready' | 'error' = 'loading';
	let photos: ModerationPhoto[] = [];
	let requireApproval = false;
	let urls: Record<string, string> = {};
	let filesReady = false;
	let notice = '';
	let busy = false;
	let loadedFor = '';

	async function refresh(uid: string) {
		notice = '';
		try {
			const result = await loadModeration();
			if ($user?.uid !== uid) return;
			for (const url of Object.values(urls)) URL.revokeObjectURL(url);
			urls = {};
			photos = result.photos;
			requireApproval = result.requireApproval;
			filesReady = false;
			status = 'ready';
			const next: Record<string, string> = {};
			await Promise.all(
				photos.map(async (photo) => {
					try {
						next[photo.photoId] = await adminPhotoObjectUrl(photo.photoId);
					} catch {
						// A missing file still leaves the report visible.
					}
				})
			);
			if ($user?.uid !== uid) return;
			urls = next;
			filesReady = true;
		} catch (error) {
			console.error('Could not load photo reports', error);
			if ($user?.uid !== uid) return;
			notice = error instanceof Error ? error.message : 'Photo reports could not be loaded.';
			status = 'error';
		}
	}

	$: if (!$accountSessionReady) {
		status = 'loading';
	} else if (!$user) {
		status = 'signed-out';
		loadedFor = '';
	} else if (!$isAdministrator) {
		status = 'forbidden';
		loadedFor = '';
	} else if (loadedFor !== $user.uid) {
		loadedFor = $user.uid;
		void refresh($user.uid);
	}

	async function act(action: 'hide' | 'remove' | 'approve', photoId: string) {
		if (busy || !$user) return;
		busy = true;
		notice = '';
		try {
			await moderatePhoto(action, { photoId });
			await refresh($user.uid);
		} catch (error) {
			notice = error instanceof Error ? error.message : 'That change could not be saved.';
		} finally {
			busy = false;
		}
	}

	async function setApproval(enabled: boolean, input: HTMLInputElement) {
		input.checked = requireApproval;
		if (busy || !$user) return;
		busy = true;
		notice = '';
		try {
			await moderatePhoto('setRequireApproval', { requireApproval: enabled });
			await refresh($user.uid);
		} catch (error) {
			notice = error instanceof Error ? error.message : 'That change could not be saved.';
		} finally {
			busy = false;
		}
	}

	onDestroy(() => {
		for (const url of Object.values(urls)) URL.revokeObjectURL(url);
	});
</script>

<svelte:head>
	<title>Photo reports - Gaslands Garage</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<section class="mx-auto max-w-5xl px-2 py-8 text-stone-800 dark:text-gray-100" data-testid="admin-gallery">
	<p class="mb-3"><a class="text-amber-800 underline dark:text-amber-300" href="/admin/users">Back to users</a></p>
	<h1 class="mb-2 text-3xl font-bold">Photo reports</h1>
	<p class="mb-4 max-w-3xl text-stone-600 dark:text-gray-300">
		Gallery photos appear as soon as a player shares them. Three different players reporting a photo hide it until you review it.
		Turn on approval if you want new gallery photos to wait for you. Buddies and team share links are not held for approval.
	</p>

	{#if status === 'loading'}
		<p>Loading…</p>
	{:else if status === 'signed-out'}
		<p>Sign in to review photos.</p>
	{:else if status === 'forbidden'}
		<p>You need the Administrator role to review photos.</p>
	{:else if status === 'error'}
		<p role="alert">{notice || 'Photo reports could not be loaded.'}</p>
	{:else}
		<label class="mb-6 flex items-start gap-2 text-sm">
			<input
				type="checkbox"
				class="mt-1"
				data-testid="gallery-require-approval"
				checked={requireApproval}
				disabled={busy}
				on:change={(event) => {
					const input = event.currentTarget;
					if (input instanceof HTMLInputElement) void setApproval(input.checked, input);
				}}
			/>
			<span>
				Require approval before a photo appears in the Gallery.
				<span class="block text-stone-600 dark:text-gray-300">New gallery shares stay unpublished until you approve them. Photos already in the Gallery stay up.</span>
			</span>
		</label>

		{#if notice}
			<p role="alert" class="mb-4 text-red-800 dark:text-red-200">{notice}</p>
		{/if}

		{#if photos.length === 0}
			<p data-testid="admin-gallery-empty">No shared photos.</p>
		{:else}
			<ul class="space-y-4" data-testid="admin-gallery-list">
				{#each photos as photo (photo.photoId)}
					<li class="rounded-lg border border-stone-300 bg-white p-3 dark:border-gray-600 dark:bg-gray-900">
						<div class="flex flex-col gap-3 sm:flex-row">
							{#if urls[photo.photoId]}
								<img src={urls[photo.photoId]} alt={photo.caption || photo.vehicleType} class="h-32 w-full rounded object-cover sm:w-40" />
							{:else if !filesReady}
								<div class="flex h-32 w-full items-center justify-center rounded bg-stone-100 text-sm text-stone-600 sm:w-40">Loading photo…</div>
							{:else}
								<div class="flex h-32 w-full items-center justify-center rounded bg-stone-100 text-sm text-stone-600 sm:w-40">Photo file unavailable</div>
							{/if}
							<div class="min-w-0">
								<p class="font-semibold">{photo.displayName}</p>
								<p class="text-sm">{photo.vehicleType}{#if photo.teamName} · {photo.teamName}{/if}</p>
								{#if photo.caption}
									<p class="text-sm">{photo.caption}</p>
								{/if}
								<p class="mt-1 text-xs text-stone-600 dark:text-gray-300">Photo {photo.photoId}</p>
								<p class="text-xs text-stone-600 dark:text-gray-300">
									{photo.reportCount} report{photo.reportCount === 1 ? '' : 's'}
									{#if photo.hidden} · hidden{/if}
									{#if photo.showInGallery && !photo.published} · waiting for approval{/if}
									{#if !photo.showInGallery} · not in the gallery{/if}
								</p>
								<div class="mt-2 flex flex-wrap gap-2">
									<button type="button" class="rounded-md border border-stone-300 px-3 py-1 text-sm dark:border-gray-600" disabled={busy} data-testid="moderate-hide" on:click={() => act('hide', photo.photoId)}>Hide</button>
									{#if photo.showInGallery && (!photo.published || photo.hidden)}
										<button type="button" class="rounded-md px-3 py-1 text-sm amber-button" disabled={busy} data-testid="moderate-approve" on:click={() => act('approve', photo.photoId)}>Approve</button>
									{/if}
									<button type="button" class="rounded-md px-3 py-1 text-sm text-red-800 underline dark:text-red-200" disabled={busy} data-testid="moderate-remove" on:click={() => act('remove', photo.photoId)}>Remove</button>
								</div>
							</div>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</section>
