<script lang="ts">
  import { onMount } from 'svelte';
  import { db, initializeFirebase } from '$lib/firebase';
  import { loadSponsors } from '$lib/rules/loadRules';

  type SponsorCount = { sponsorId: string; count: number };
  type PublicStats = {
    updatedAt: string;
    totalUsers: number;
    totalTeams: number;
    totalVehicles: number;
    teamsByRulesVersion: { v2: number; v3: number };
    teamsBySponsor: SponsorCount[];
    teamsCreatedLast30Days: number;
  };

  const sponsorNames = new Map(loadSponsors().map((sponsor) => [sponsor.id, sponsor.name]));
  const extraSponsorNames: Record<string, string> = {
    chivo: 'Chivo',
    jumbo: 'Jumbo',
    rusty: 'Rusty',
    order_of_the_inferno: 'Order of the Inferno'
  };

  let status: 'loading' | 'empty' | 'ready' = 'loading';
  let stats: PublicStats | null = null;

  function count(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  function sponsorLabel(id: string): string {
    return sponsorNames.get(id) ?? extraSponsorNames[id] ?? id.replaceAll('_', ' ');
  }

  function formatWhen(iso: string): string {
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return iso;
    return parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function readStats(data: Record<string, unknown>): PublicStats {
    const versions = (data.teamsByRulesVersion ?? {}) as { v2?: unknown; v3?: unknown };
    const sponsors = Array.isArray(data.teamsBySponsor) ? data.teamsBySponsor : [];
    return {
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
      totalUsers: count(data.totalUsers),
      totalTeams: count(data.totalTeams),
      totalVehicles: count(data.totalVehicles),
      teamsByRulesVersion: { v2: count(versions.v2), v3: count(versions.v3) },
      teamsBySponsor: sponsors
        .map((entry) => {
          const row = entry as { sponsorId?: unknown; count?: unknown };
          const sponsorId = typeof row.sponsorId === 'string' ? row.sponsorId : 'unknown';
          return { sponsorId, count: count(row.count) };
        })
        .filter((row) => row.count > 0),
      teamsCreatedLast30Days: count(data.teamsCreatedLast30Days)
    };
  }

  onMount(async () => {
    try {
      const init = await initializeFirebase();
      if (!init.success || !db) {
        status = 'empty';
        return;
      }
      const { doc, getDoc } = await import('firebase/firestore');
      const snap = await getDoc(doc(db, 'stats', 'public'));
      if (!snap.exists()) {
        status = 'empty';
        return;
      }
      stats = readStats(snap.data() as Record<string, unknown>);
      status = 'ready';
    } catch (error) {
      console.error('Usage stats are not available yet', error);
      status = 'empty';
    }
  });
</script>

<svelte:head>
  <title>Usage Stats - Gaslands Garage</title>
  <meta name="description" content="Anonymous usage totals for saved Gaslands Garage teams. Individual teams and accounts stay private." />
  <meta name="robots" content="noindex" />
  <link rel="canonical" href="https://gaslandsgarage.com/stats" />
</svelte:head>

<section class="max-w-3xl mx-auto py-8 px-2 text-stone-800 dark:text-gray-100">
  <h1 class="text-3xl font-bold mb-2">Usage Stats</h1>
  <p class="text-stone-600 dark:text-gray-300 mb-6">
    Totals from saved teams. Individual teams and accounts stay private.
  </p>

  {#if status === 'loading'}
    <p data-testid="stats-loading" class="text-stone-600 dark:text-gray-300">Loading usage stats…</p>
  {:else if status === 'empty' || !stats}
    <div data-testid="stats-empty" class="bg-white dark:bg-gray-800 border border-stone-200 dark:border-gray-700 rounded-lg p-6">
      <p class="font-medium">No usage stats have been published yet.</p>
      <p class="mt-2 text-stone-600 dark:text-gray-300">Counts appear here after the daily update runs.</p>
    </div>
  {:else}
    <div data-testid="stats-totals">
      <p class="text-sm text-stone-500 dark:text-gray-400 mb-4">
        Last updated
        <time datetime={stats.updatedAt}>{formatWhen(stats.updatedAt)}</time>
      </p>
      <dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div class="bg-white dark:bg-gray-800 rounded-lg p-4 border border-stone-200 dark:border-gray-700">
          <dt class="text-sm text-stone-500 dark:text-gray-400">Users</dt>
          <dd class="text-2xl font-bold">{stats.totalUsers.toLocaleString('en-US')}</dd>
        </div>
        <div class="bg-white dark:bg-gray-800 rounded-lg p-4 border border-stone-200 dark:border-gray-700">
          <dt class="text-sm text-stone-500 dark:text-gray-400">Teams</dt>
          <dd class="text-2xl font-bold">{stats.totalTeams.toLocaleString('en-US')}</dd>
        </div>
        <div class="bg-white dark:bg-gray-800 rounded-lg p-4 border border-stone-200 dark:border-gray-700">
          <dt class="text-sm text-stone-500 dark:text-gray-400">Vehicles</dt>
          <dd class="text-2xl font-bold">{stats.totalVehicles.toLocaleString('en-US')}</dd>
        </div>
        <div class="bg-white dark:bg-gray-800 rounded-lg p-4 border border-stone-200 dark:border-gray-700">
          <dt class="text-sm text-stone-500 dark:text-gray-400">New teams, 30 days</dt>
          <dd class="text-2xl font-bold">{stats.teamsCreatedLast30Days.toLocaleString('en-US')}</dd>
        </div>
      </dl>

      <h2 class="text-xl font-bold mt-8 mb-3">Rules version</h2>
      <ul class="bg-white dark:bg-gray-800 rounded-lg border border-stone-200 dark:border-gray-700 divide-y divide-stone-200 dark:divide-gray-700">
        <li class="flex justify-between px-4 py-3"><span>Refuelled (v2)</span><span class="font-bold">{stats.teamsByRulesVersion.v2.toLocaleString('en-US')}</span></li>
        <li class="flex justify-between px-4 py-3"><span>Version 3</span><span class="font-bold">{stats.teamsByRulesVersion.v3.toLocaleString('en-US')}</span></li>
      </ul>

      <h2 class="text-xl font-bold mt-8 mb-3">Teams per sponsor</h2>
      {#if stats.teamsBySponsor.length === 0}
        <p class="text-stone-600 dark:text-gray-300">No saved teams yet.</p>
      {:else}
        <ul class="bg-white dark:bg-gray-800 rounded-lg border border-stone-200 dark:border-gray-700 divide-y divide-stone-200 dark:divide-gray-700">
          {#each stats.teamsBySponsor as row (row.sponsorId)}
            <li class="flex justify-between px-4 py-3">
              <span>{sponsorLabel(row.sponsorId)}</span>
              <span class="font-bold">{row.count.toLocaleString('en-US')}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</section>
