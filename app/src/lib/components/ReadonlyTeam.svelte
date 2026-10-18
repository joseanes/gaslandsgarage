<script lang="ts">
	import BuildHeader from '$lib/components/BuildHeader.svelte';
	import { loadPerks, loadSponsors, loadUpgrades, loadVehicles, loadWeapons } from '$lib/rules/loadRules';
	import { rulesVersionLabel, summarizeVehicle, type ViewVehicle } from '$lib/admin/teamView';

	export let teamName = 'Untitled team';
	export let sponsorId = '';
	export let rulesVersion: 2 | 3 | null = null;
	export let maxCans: number | null = null;
	export let vehicles: ViewVehicle[] = [];

	const sponsors = loadSponsors();
	const catalogs = {
		vehicles: loadVehicles(),
		weapons: loadWeapons(),
		upgrades: loadUpgrades(),
		perks: loadPerks()
	};

	$: sponsorName = sponsors.find((sponsor) => sponsor.id === sponsorId)?.name || sponsorId;
	$: summaries = vehicles.map((vehicle) => summarizeVehicle(vehicle, catalogs));
	$: totalCans = summaries.reduce((sum, vehicle) => sum + vehicle.cans, 0);
</script>

<article class="rounded-lg border border-stone-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800" data-testid="readonly-team">
	<header class="mb-3">
		<h3 class="text-lg font-bold text-stone-800 dark:text-gray-100">{teamName}</h3>
		<p class="text-sm text-stone-600 dark:text-gray-300">
			{sponsorName || 'No sponsor'}
			· {rulesVersionLabel(rulesVersion)}
			· {totalCans}{maxCans != null ? `/${maxCans}` : ''} cans
		</p>
	</header>
	{#if summaries.length === 0}
		<p class="text-sm text-stone-600 dark:text-gray-300">This team has no vehicles.</p>
	{:else}
		<ul class="space-y-3">
			{#each summaries as vehicle (vehicle.id)}
				<li class="rounded-md border border-stone-200 p-3 dark:border-gray-600" data-testid="vehicle-readonly">
					<div class="mb-2 flex flex-wrap items-center justify-between gap-2">
						<p class="font-medium text-stone-800 dark:text-gray-100">
							{vehicle.typeName} · {vehicle.name}
							{#if vehicle.driverName}<span class="font-normal text-stone-600 dark:text-gray-300"> · {vehicle.driverName}</span>{/if}
						</p>
						<BuildHeader vehicleCost={vehicle.cans} usedBuildSlots={vehicle.usedSlots} maxBuildSlots={vehicle.maxSlots} />
					</div>
					<dl class="grid gap-1 text-sm text-stone-700 dark:text-gray-200">
						{#if vehicle.weapons.length > 0}
							<div><dt class="inline font-medium">Weapons:</dt> <dd class="inline">{vehicle.weapons.join(', ')}</dd></div>
						{/if}
						{#if vehicle.upgrades.length > 0}
							<div><dt class="inline font-medium">Upgrades:</dt> <dd class="inline">{vehicle.upgrades.join(', ')}</dd></div>
						{/if}
						{#if vehicle.perks.length > 0}
							<div><dt class="inline font-medium">Perks:</dt> <dd class="inline">{vehicle.perks.join(', ')}</dd></div>
						{/if}
					</dl>
				</li>
			{/each}
		</ul>
	{/if}
</article>
