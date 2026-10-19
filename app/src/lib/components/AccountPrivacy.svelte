<script lang="ts">
  import { user } from '$lib/firebase';
  import { deleteMyAccount, downloadMyData } from '$lib/privacy/accountClient';
  import { DELETE_CONFIRMATION, privacyErrorMessage } from '$lib/privacy/accountShared';

  let confirmation = '';
  let busy = false;
  let notice = '';
  let error = '';

  $: canDelete = confirmation === DELETE_CONFIRMATION && !busy;

  async function download() {
    if (busy) return;
    busy = true;
    notice = '';
    error = '';
    try {
      await downloadMyData();
      notice = 'Your download has started.';
    } catch (caught) {
      error = privacyErrorMessage(caught);
    } finally {
      busy = false;
    }
  }

  async function removeAccount() {
    if (!canDelete) return;
    busy = true;
    notice = '';
    error = '';
    try {
      await deleteMyAccount();
      confirmation = '';
      notice = 'Your account has been deleted.';
    } catch (caught) {
      error = privacyErrorMessage(caught);
    } finally {
      busy = false;
    }
  }
</script>

{#if $user}
  <div class="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/30 space-y-3" data-testid="account-privacy">
    <h4 class="font-medium text-stone-800 dark:text-white">Your data</h4>
    <p class="text-stone-600 dark:text-gray-200 text-sm">
      Download a JSON file of the teams, settings, profile, messages, map pin, and painted-car photos stored for this account. The download lists your photos and which ones you chose to share. It does not include image links.
    </p>
    <button
      type="button"
      class="px-4 py-2 rounded-lg border-2 border-stone-800 bg-stone-800 text-white font-semibold disabled:opacity-60"
      data-testid="download-my-data"
      disabled={busy}
      on:click={download}
    >
      Download my data
    </button>

    <h4 class="font-medium text-stone-800 dark:text-white pt-2">Delete my account</h4>
    <p class="text-stone-600 dark:text-gray-200 text-sm">
      This removes your teams, settings, profile, and painted-car photos, including any copies you shared to buddies, a team link, or the Gallery. It also takes your pin off the players map and anonymizes your side of
      game requests and contact messages. It cannot be undone. You will be asked to sign in with Google again.
      Administrators can disable an account, and only you can delete yours.
    </p>
    <div>
      <label for="delete-account-confirmation" class="block text-stone-800 dark:text-white font-medium mb-1">
        Type DELETE to confirm
      </label>
      <input
        id="delete-account-confirmation"
        type="text"
        bind:value={confirmation}
        autocomplete="off"
        spellcheck="false"
        data-testid="delete-account-confirmation"
        class="w-full max-w-xs px-4 py-2 border border-stone-300 dark:border-gray-600 rounded-md text-stone-800 dark:text-white bg-white dark:bg-gray-700"
      />
    </div>
    <button
      type="button"
      class="px-4 py-2 rounded-lg border-2 border-red-800 text-red-800 dark:text-red-200 dark:border-red-200 font-semibold disabled:opacity-60"
      data-testid="delete-my-account"
      disabled={!canDelete}
      on:click={removeAccount}
    >
      Delete my account
    </button>
    {#if notice}
      <p class="text-sm text-stone-800 dark:text-white" role="status">{notice}</p>
    {/if}
    {#if error}
      <p class="text-sm text-red-800 dark:text-red-200" role="alert">{error}</p>
    {/if}
  </div>
{/if}
