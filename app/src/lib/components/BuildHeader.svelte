<script lang="ts">
    // BuildHeader.svelte - A component to display vehicle build information in the header

    // Props
    export let vehicleCost: number;
    export let usedBuildSlots: number;
    export let maxBuildSlots: number;
</script>

<div class="flex items-center gap-2 self-start flex-1 md:flex-auto">
    <!-- Vehicle cost badge - Consistent height with buttons -->
    <div class="bg-amber-700 text-white h-[32px] min-h-[32px] max-h-[32px] px-2 md:px-3 flex-1 md:flex-auto flex items-center justify-center rounded-md text-xs md:text-sm font-semibold shadow-sm whitespace-nowrap">
        {typeof vehicleCost === 'number' ? vehicleCost : '?'} cans
    </div>

    <!-- Build slots badge - Consistent height with buttons -->
    <div class="bg-blue-600 text-white h-[32px] min-h-[32px] max-h-[32px] px-2 md:px-3 flex-1 md:flex-auto flex items-center justify-center rounded-md text-xs md:text-sm font-semibold shadow-sm whitespace-nowrap">
        <span class="mr-1">Slots:</span>
        {#if maxBuildSlots === 0}
            <span>N/A</span>
        {:else}
            <span>{usedBuildSlots}/{maxBuildSlots}</span>
        {/if}
    </div>
</div>