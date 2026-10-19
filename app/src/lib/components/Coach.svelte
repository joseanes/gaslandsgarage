<script lang="ts">
    import { fade } from 'svelte/transition';
    import StatusChip from './StatusChip.svelte';
    import { EMPTY_NEXT_VEHICLE_MESSAGE, recommendNextVehicles, type NextVehicleCatalogEntry } from '$lib/coach/nextVehicle';
    import { evaluateTeam, metricValue, type ScoreVehicle, type TeamEvaluation } from '$lib/coach/score';
    import { buildCoachSuggestions } from '$lib/coach/suggestions';
    import {
        METRICS,
        TILE_METRICS,
        comparisonSentence,
        formatAbout,
        formatFixed,
        thresholdTooltip,
        typicalBudgetLine,
        type MetricId,
        type ScoreStatus
    } from '$lib/coach/thresholds';
    import type { Perk, Sponsor, Upgrade, Vehicle, VehicleRule, Weapon } from '$lib/rules/types';
    import { countedVehicleTotal, maxCountedVehicles } from '$lib/rules/version';

    interface TeamVehicle extends ScoreVehicle {
        driverName?: string;
        secondPerkClass?: string;
    }

    export let vehicles: TeamVehicle[] = [];
    export let vehicleTypes: Vehicle[] = [];
    export let weapons: Weapon[] = [];
    export let upgrades: Upgrade[] = [];
    export let perks: Perk[] = [];
    export let vehicleRules: VehicleRule[] = [];
    export let currentSponsor: Sponsor | null | undefined = null;
    export let totalCans = 0;
    export let maxCans = 50;
    export let rulesVersion: 2 | 3 = 2;
    export let drivers: { id: string; name: string; perkClass: string }[] = [];
    export let includeAdvanced = true;
    export let addingDisabled = false;
    export let onAddVehicle: (vehicleType: string) => void = () => {};
    export let issues: string[] = [];

    let detailsChoice: boolean | null = null;

    function listHasGear(list: TeamVehicle[]) {
        return list.some((vehicle) =>
            (vehicle.weapons?.length || 0) > 0 ||
            (vehicle.upgrades?.length || 0) > 0 ||
            (vehicle.perks?.length || 0) > 0
        );
    }

    $: detailsOpen = detailsChoice === null ? listHasGear(vehicles) : detailsChoice;
    $: void perks;

    function toggleDetails() {
        detailsChoice = !detailsOpen;
    }

    function valueClass(status: ScoreStatus): string {
        if (status === 'good') return 'text-green-800 dark:text-green-200';
        if (status === 'ok') return 'text-amber-800 dark:text-amber-200';
        return 'text-red-800 dark:text-red-200';
    }

    function barClass(status: ScoreStatus): string {
        if (status === 'good') return 'border-l-green-700 dark:border-l-green-300';
        if (status === 'ok') return 'border-l-amber-600 dark:border-l-amber-300';
        return 'border-l-red-700 dark:border-l-red-300';
    }

    function leadRule(
        report: TeamEvaluation,
        problemList: string[],
        spent: number,
        budget: number,
        version: 2 | 3,
        team: TeamVehicle[]
    ) {
        const fromValidation = problemList.find((issue) => issue.trim().length > 0);
        if (fromValidation) return fromValidation;
        if (spent > Number(budget)) return `Team exceeds ${budget} cans limit`;
        if (version === 3) {
            if (team.some((vehicle) => !vehicle.driverArchetype)) {
                return 'Give every vehicle a driver. Drivers are free, and each archetype can be used once.';
            }
            const archetypes = team
                .map((vehicle) => vehicle.driverArchetype)
                .filter((id): id is string => Boolean(id));
            if (new Set(archetypes).size !== archetypes.length) {
                return 'Two vehicles share a driver archetype. Each archetype can be used once.';
            }
            if (report.scores.slotEfficiency > 100) return 'A vehicle is using more build slots than it has.';
            const allowance = maxCountedVehicles(Number(budget) || 50);
            const counted = countedVehicleTotal(team.map((vehicle) => vehicle.type));
            if (counted > allowance) return `Too many vehicles for ${budget} cans.`;
            const spark = team.some((vehicle) => vehicle.driverArchetype === 'spark');
            const van = team.some((vehicle) => vehicle.type === 'van');
            if (report.electrical > 0 && !spark && !van) {
                return 'Electrical weapons need a Spark driver on the team, or a van for that vehicle.';
            }
        } else if (report.scores.slotEfficiency > 100) {
            return 'A vehicle is using more build slots than it has.';
        }
        return 'No rules issues';
    }

    $: evaluation = evaluateTeam({
        vehicles,
        vehicleTypes,
        weapons,
        upgrades,
        vehicleRules,
        rulesVersion,
        totalCans,
        maxCans
    });

    $: catalog = vehicleTypes as NextVehicleCatalogEntry[];

    $: nextVehicles = recommendNextVehicles({
        rulesVersion,
        sponsorId: currentSponsor?.id ?? 'no_sponsor',
        catalog,
        team: vehicles.map((vehicle) => ({ type: vehicle.type })),
        totalCans,
        maxCans,
        includeAdvanced,
        snapshot: evaluation.snapshot
    });

    $: coachSuggestions = buildCoachSuggestions({
        rulesVersion,
        vehicles,
        vehicleTypes,
        weapons,
        upgrades,
        evaluation,
        sponsor: currentSponsor
            ? {
                id: currentSponsor.id,
                name: currentSponsor.name,
                electrical: currentSponsor.electrical,
                requirement: currentSponsor.requirement
            }
            : null,
        drivers,
        includeAdvanced,
        catalog,
        teamTypes: vehicles.map((vehicle) => ({ type: vehicle.type }))
    });

    $: lead = leadRule(evaluation, issues, totalCans, maxCans, rulesVersion, vehicles);
    $: rulesClear = lead === 'No rules issues';
    $: ranges = evaluation.ranges;
    $: rangeTotal = Object.values(ranges).reduce((sum, count) => sum + count, 0);
    $: weights = evaluation.weights;
    $: weightTotal = Object.values(weights).reduce((sum, count) => sum + count, 0);

    function tip(id: MetricId): string {
        return thresholdTooltip(METRICS[id], metricValue(evaluation.scores, id), maxCans);
    }

    function tileValue(id: MetricId): string {
        return formatFixed(metricValue(evaluation.scores, id), METRICS[id]);
    }
</script>

<div class="mt-3 bg-stone-100 dark:bg-gray-700 p-3 sm:p-4 rounded-lg" in:fade={{ duration: 200 }} data-testid="coach-panel">
    <div
        class="inline-flex max-w-full items-start gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold {rulesClear
            ? 'border-green-800 bg-green-100 text-green-950 dark:border-green-200 dark:bg-green-950 dark:text-green-100'
            : 'border-red-800 bg-red-100 text-red-950 dark:border-red-200 dark:bg-red-950 dark:text-red-100'}"
        data-testid="coach-lead"
        role="status"
    >
        {#if rulesClear}
            <svg xmlns="http://www.w3.org/2000/svg" class="mt-0.5 h-3.5 w-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
            </svg>
            No rules issues
        {:else}
            <svg xmlns="http://www.w3.org/2000/svg" class="mt-0.5 h-3.5 w-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.72-1.36 3.485 0l6.518 11.59c.75 1.335-.213 2.986-1.742 2.986H3.48c-1.53 0-2.493-1.651-1.743-2.986L8.257 3.1zM11 13a1 1 0 10-2 0 1 1 0 002 0zm-1-7a1 1 0 00-1 1v3a1 1 0 102 0V7a1 1 0 00-1-1z" clip-rule="evenodd" />
            </svg>
            <span>{lead}</span>
        {/if}
    </div>

    <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
        <h3 class="text-base font-bold text-stone-800 dark:text-white sm:text-lg">Gaslands Coach <span data-testid="coach-rules">Version {rulesVersion}</span></h3>
        <div class="flex items-center gap-2">
            <div class="text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-950 dark:text-amber-100 py-1 px-2.5 rounded-full" data-testid="coach-cans">
                {totalCans} / {maxCans} cans · {evaluation.cansLeft} left
            </div>
            <button
                type="button"
                class="text-sm font-medium text-amber-800 dark:text-amber-200 underline"
                on:click={toggleDetails}
            >
                {detailsOpen ? 'Hide details' : 'Show details'}
            </button>
        </div>
    </div>

    <p class="mt-2 text-[11px] leading-snug text-stone-600 dark:text-gray-200" data-testid="coach-typical">{typicalBudgetLine(maxCans)}</p>

    <div class="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        {#each TILE_METRICS as band (band.id)}
            <div class="rounded-lg border-l-4 bg-stone-200 p-2 text-left dark:bg-gray-600 {barClass(evaluation.statuses[band.id])}" data-testid="coach-tile-{band.id}">
                <div class="text-[10px] font-semibold uppercase leading-tight text-stone-600 dark:text-gray-200">{band.title}</div>
                <div class="mt-1 flex items-center justify-between gap-1">
                    <span class="text-lg font-bold leading-none {valueClass(evaluation.statuses[band.id])}" data-testid="coach-value-{band.id}">{tileValue(band.id)}</span>
                    <StatusChip status={evaluation.statuses[band.id]} tooltip={tip(band.id)} testId="coach-status-{band.id}" />
                </div>
                <p class="mt-1 text-[10px] leading-snug text-stone-600 dark:text-gray-200">
                    {band.unit} · typical {formatAbout(band.typical, band.decimals)}{band.suffix}
                </p>
            </div>
        {/each}
    </div>

    <div class="mt-3 bg-amber-50 dark:bg-amber-950/40 p-3 rounded-lg border border-amber-300 dark:border-amber-700" data-testid="coach-next-vehicle">
        <h4 class="mb-2 text-sm font-bold text-amber-950 dark:text-amber-100">What to add next</h4>
        {#if nextVehicles.length === 0}
            <p class="text-sm text-amber-900 dark:text-amber-100" data-testid="coach-next-empty">{EMPTY_NEXT_VEHICLE_MESSAGE}</p>
        {:else}
            <ul class="space-y-2">
                {#each nextVehicles as suggestion (suggestion.id)}
                    <li id="coach-add-{suggestion.id}" class="scroll-mt-20 flex items-start justify-between gap-2 text-sm text-amber-950 dark:text-amber-50">
                        <div class="min-w-0">
                            <div>
                                <span class="font-semibold">{suggestion.name}</span>
                                <span class="text-amber-900 dark:text-amber-100"> · {suggestion.cost} cans</span>
                            </div>
                            <p class="text-xs leading-snug text-amber-900 dark:text-amber-100">{suggestion.reason}</p>
                        </div>
                        <button
                            type="button"
                            class="shrink-0 px-3 py-1 rounded-md bg-amber-500 text-stone-950 font-semibold hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed"
                            data-testid="coach-add-{suggestion.id}"
                            aria-label="Add {suggestion.name}"
                            disabled={addingDisabled}
                            on:click={() => onAddVehicle(suggestion.id)}
                        >Add</button>
                    </li>
                {/each}
            </ul>
        {/if}
    </div>

    {#if coachSuggestions.length > 0}
        <div class="mt-3 bg-amber-50 dark:bg-amber-950/40 p-3 rounded-lg border border-amber-300 dark:border-amber-700" data-testid="coach-suggestions">
            <h4 class="text-sm font-bold text-amber-950 dark:text-amber-100 mb-2">Coach Suggestions</h4>
            <ul class="space-y-2">
                {#each coachSuggestions as suggestion (suggestion.id)}
                    <li class="flex flex-wrap items-start justify-between gap-2 text-xs sm:text-sm text-amber-950 dark:text-amber-50">
                        <p class="min-w-0 flex-1 leading-snug">
                            {suggestion.lead}{#if suggestion.href && suggestion.linkLabel}<a href={suggestion.href} class="font-semibold underline">{suggestion.linkLabel}</a>{/if}{suggestion.tail}
                        </p>
                        {#if suggestion.addType && suggestion.addName}
                            <button
                                type="button"
                                class="shrink-0 px-3 py-1 rounded-md bg-amber-500 text-stone-950 text-xs font-semibold hover:bg-amber-400 disabled:opacity-50"
                                data-testid="coach-suggest-add-{suggestion.addType}"
                                aria-label="Add {suggestion.addName}"
                                disabled={addingDisabled}
                                on:click={() => suggestion.addType && onAddVehicle(suggestion.addType)}
                            >Add</button>
                        {/if}
                    </li>
                {/each}
            </ul>
        </div>
    {/if}

    {#if detailsOpen}
    {#if rulesVersion === 3}
        <p class="mt-3 text-sm text-stone-800 dark:text-gray-100" data-testid="coach-counted">
            Version 3: {countedVehicleTotal(vehicles.map((vehicle) => vehicle.type))} of {maxCountedVehicles(Number(maxCans) || 50)} counted vehicles (the first bike is free, 3 max).
        </p>
    {/if}
    <div class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div class="bg-stone-200 dark:bg-gray-600 p-3 rounded-lg">
            <h4 class="text-sm font-bold text-stone-800 dark:text-white mb-2 pb-2 border-b border-stone-300 dark:border-gray-500">Combat Analysis</h4>
            <div class="grid grid-cols-2 gap-3">
                <div>
                    <div class="text-xs text-stone-600 dark:text-gray-200 font-semibold">Attack dice</div>
                    <div class="mt-1 flex flex-wrap items-center gap-1">
                        <span class="font-bold text-stone-900 dark:text-white">{evaluation.snapshot.attackDice}</span>
                        <span class="text-xs text-stone-600 dark:text-gray-300">total</span>
                        <span class="font-bold {valueClass(evaluation.statuses.combat)}" data-testid="coach-analysis-combat">{formatFixed(evaluation.scores.combat, METRICS.combat)}</span>
                        <span class="text-xs text-stone-600 dark:text-gray-300">/ can</span>
                        <StatusChip status={evaluation.statuses.combat} tooltip={tip('combat')} />
                    </div>
                    <p class="mt-1 text-[10px] leading-snug text-stone-600 dark:text-gray-200">{comparisonSentence(evaluation.scores.combat, METRICS.combat, maxCans)}</p>
                </div>
                <div>
                    <div class="text-xs text-stone-600 dark:text-gray-200 font-semibold">Weapons</div>
                    <div class="mt-1 flex items-center">
                        <span class="font-bold text-stone-900 dark:text-white">{evaluation.weaponCount}</span>
                        <span class="ml-2 text-xs text-stone-600 dark:text-gray-300">total</span>
                    </div>
                </div>
                {#if evaluation.electrical > 0 || evaluation.nonElectrical > 0}
                    <div>
                        <div class="text-xs text-stone-600 dark:text-gray-200 font-semibold">Electrical</div>
                        <div class="mt-1 text-stone-900 dark:text-white"><span class="font-bold">{evaluation.electrical}</span> <span class="text-xs text-stone-600 dark:text-gray-300">weapons</span></div>
                    </div>
                    <div>
                        <div class="text-xs text-stone-600 dark:text-gray-200 font-semibold">Standard</div>
                        <div class="mt-1 text-stone-900 dark:text-white"><span class="font-bold">{evaluation.nonElectrical}</span> <span class="text-xs text-stone-600 dark:text-gray-300">weapons</span></div>
                    </div>
                {/if}
            </div>
            {#if rangeTotal > 0}
                <div class="mt-3">
                    <div class="text-xs text-stone-600 dark:text-gray-200 font-semibold mb-1">Range</div>
                    <div class="flex flex-wrap gap-1">
                        {#each Object.entries(ranges) as [name, count] (name)}
                            {#if count > 0}
                                <div class="py-0.5 px-1.5 bg-amber-100 dark:bg-amber-950 text-amber-950 dark:text-amber-100 rounded text-[11px]">{name.slice(0, 1).toUpperCase()}{name.slice(1)}: {count}</div>
                            {/if}
                        {/each}
                    </div>
                </div>
            {/if}
        </div>

        <div class="bg-stone-200 dark:bg-gray-600 p-3 rounded-lg">
            <h4 class="text-sm font-bold text-stone-800 dark:text-white mb-2 pb-2 border-b border-stone-300 dark:border-gray-500">Survivability Analysis</h4>
            <div class="grid grid-cols-2 gap-3">
                <div>
                    <div class="text-xs text-stone-600 dark:text-gray-200 font-semibold">Hull</div>
                    <div class="mt-1 flex flex-wrap items-center gap-1">
                        <span class="font-bold text-stone-900 dark:text-white">{evaluation.snapshot.hull}</span>
                        <span class="text-xs text-stone-600 dark:text-gray-300">total</span>
                        <span class="font-bold {valueClass(evaluation.statuses.survivability)}" data-testid="coach-analysis-hull">{formatFixed(evaluation.scores.survivability, METRICS.survivability)}</span>
                        <span class="text-xs text-stone-600 dark:text-gray-300">/ can</span>
                        <StatusChip status={evaluation.statuses.survivability} tooltip={tip('survivability')} />
                    </div>
                    <p class="mt-1 text-[10px] leading-snug text-stone-600 dark:text-gray-200">{comparisonSentence(evaluation.scores.survivability, METRICS.survivability, maxCans)}</p>
                </div>
                <div>
                    <div class="text-xs text-stone-600 dark:text-gray-200 font-semibold">Vehicles</div>
                    <div class="mt-1 font-bold text-stone-900 dark:text-white">{vehicles.length}</div>
                </div>
                <div>
                    <div class="text-xs text-stone-600 dark:text-gray-200 font-semibold">Avg. gear</div>
                    <div class="mt-1 flex flex-wrap items-center gap-1">
                        <span class="font-bold {valueClass(evaluation.statuses.gear)}" data-testid="coach-analysis-gear">{formatFixed(evaluation.scores.avgGear, METRICS.gear)}</span>
                        <StatusChip status={evaluation.statuses.gear} tooltip={tip('gear')} testId="coach-status-gear" />
                    </div>
                </div>
                <div>
                    <div class="text-xs text-stone-600 dark:text-gray-200 font-semibold">Avg. handling</div>
                    <div class="mt-1 flex flex-wrap items-center gap-1">
                        <span class="font-bold {valueClass(evaluation.statuses.handling)}" data-testid="coach-analysis-handling">{formatFixed(evaluation.scores.avgHandling, METRICS.handling)}</span>
                        <StatusChip status={evaluation.statuses.handling} tooltip={tip('handling')} testId="coach-status-handling" />
                    </div>
                </div>
            </div>
            {#if weightTotal > 0}
                <div class="mt-3">
                    <div class="text-xs text-stone-600 dark:text-gray-200 font-semibold mb-1">Weight classes</div>
                    <div class="flex flex-wrap gap-1">
                        {#if weights.Lightweight > 0}
                            <div class="py-0.5 px-1.5 bg-green-100 text-green-950 dark:bg-green-950 dark:text-green-100 rounded text-[11px]">Lightweight: {weights.Lightweight}</div>
                        {/if}
                        {#if weights.Middleweight > 0}
                            <div class="py-0.5 px-1.5 bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-100 rounded text-[11px]">Middleweight: {weights.Middleweight}</div>
                        {/if}
                        {#if weights.Heavyweight > 0}
                            <div class="py-0.5 px-1.5 bg-orange-100 text-orange-950 dark:bg-orange-950 dark:text-orange-100 rounded text-[11px]">Heavyweight: {weights.Heavyweight}</div>
                        {/if}
                        {#if weights.Massive > 0}
                            <div class="py-0.5 px-1.5 bg-red-100 text-red-950 dark:bg-red-950 dark:text-red-100 rounded text-[11px]">Massive: {weights.Massive}</div>
                        {/if}
                        {#if weights.Other > 0}
                            <div class="py-0.5 px-1.5 bg-purple-100 text-purple-950 dark:bg-purple-950 dark:text-purple-100 rounded text-[11px]">Other: {weights.Other}</div>
                        {/if}
                    </div>
                </div>
            {/if}
        </div>
    </div>

    {#if evaluation.specialRules.length > 0}
        <div class="bg-stone-200 dark:bg-gray-600 p-3 rounded-lg mt-3">
            <h4 class="text-sm font-bold text-stone-800 dark:text-white mb-2">Special abilities</h4>
            <div class="flex flex-wrap gap-1">
                {#each evaluation.specialRules as rule}
                    <div class="py-0.5 px-1.5 bg-stone-300 dark:bg-gray-500 text-stone-900 dark:text-white rounded text-[11px]">{rule}</div>
                {/each}
            </div>
        </div>
    {/if}
    {/if}
</div>
