<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    consentUpdatePayload,
    globalPrivacyControlEnabled,
    privacyBannerForced,
    readStoredConsent,
    readViewerCountry,
    shouldAutoShowConsentBanner,
    writeStoredConsent,
    type ConsentChoice
  } from '$lib/privacy/consent';

  let auto = false;
  let gpc = false;
  let dialogEl: HTMLDivElement | undefined;

  onMount(() => {
    gpc = globalPrivacyControlEnabled(navigator);
    const stored = readStoredConsent(localStorage);
    const country = readViewerCountry(document);
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    auto = shouldAutoShowConsentBanner({ stored, timeZone, country });
    return privacyBannerForced.subscribe(async (forced) => {
      if (!forced) return;
      await tick();
      dialogEl?.focus();
    });
  });

  function choose(choice: ConsentChoice) {
    const signal = globalPrivacyControlEnabled(navigator);
    gpc = signal;
    writeStoredConsent(localStorage, choice, signal, new Date().toISOString());
    if (typeof window.gtag === 'function') window.gtag('consent', 'update', consentUpdatePayload(choice));
    auto = false;
    privacyBannerForced.set(false);
  }

  function closeForced() {
    privacyBannerForced.set(false);
  }

  $: visible = auto || $privacyBannerForced;
</script>

{#if visible}
  <div
    bind:this={dialogEl}
    class="consent-banner print:hidden"
    role="dialog"
    aria-modal="false"
    aria-labelledby="analytics-consent-title"
    aria-describedby="analytics-consent-text"
    tabindex="-1"
    data-testid="consent-banner"
  >
    <div class="consent-banner-inner">
      <div class="consent-copy">
        <h2 id="analytics-consent-title">Analytics cookies</h2>
        <p id="analytics-consent-text">
          Gaslands Garage uses Google Analytics to see which pages are used. In the UK, Switzerland, and the EEA,
          analytics stay off unless you accept. This site does not use advertising cookies.
          <a href="/privacy">Privacy Policy</a>
        </p>
        {#if gpc}
          <p>Your browser sent Global Privacy Control, so analytics stay off unless you accept.</p>
        {/if}
      </div>
      <div class="consent-actions">
        <button type="button" class="consent-action" data-testid="consent-reject" on:click={() => choose('rejected')}>
          Reject
        </button>
        <button type="button" class="consent-action" data-testid="consent-accept" on:click={() => choose('accepted')}>
          Accept
        </button>
      </div>
      {#if $privacyBannerForced && !auto}
        <button type="button" class="consent-close" on:click={closeForced}>Close</button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .consent-banner {
    position: fixed;
    z-index: 40;
    right: 0;
    bottom: 0;
    left: 0;
    padding: 0.75rem;
  }

  .consent-banner-inner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem 1rem;
    max-width: 72rem;
    margin: 0 auto;
    padding: 1rem;
    border: 2px solid #1c1917;
    border-radius: 0.75rem;
    background: #fff;
    color: #1c1917;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
  }

  .consent-copy {
    flex: 1 1 16rem;
  }

  h2 {
    margin: 0 0 0.25rem;
    font-size: 1rem;
    font-weight: 700;
  }

  p {
    margin: 0;
    font-size: 0.95rem;
    line-height: 1.4;
  }

  a {
    color: #9a3412;
    font-weight: 600;
  }

  a:focus-visible,
  .consent-close:focus-visible,
  .consent-action:focus-visible {
    outline: 3px solid #d97706;
    outline-offset: 2px;
  }

  .consent-actions {
    display: flex;
    flex: 1 1 16rem;
    gap: 0.75rem;
  }

  .consent-action {
    flex: 1 1 7.5rem;
    min-width: 7.5rem;
    min-height: 2.75rem;
    padding: 0.5rem 1rem;
    border: 2px solid #1c1917;
    border-radius: 0.5rem;
    background: #1c1917;
    color: #fff;
    font: inherit;
    font-size: 1rem;
    font-weight: 700;
    cursor: pointer;
  }

  .consent-close {
    border: 0;
    background: transparent;
    color: #1c1917;
    font: inherit;
    font-weight: 600;
    text-decoration: underline;
    cursor: pointer;
  }
</style>
