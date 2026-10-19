<script lang="ts">
	import { STATUS_LABEL, type ScoreStatus } from '$lib/coach/thresholds';
	import Tooltip from './Tooltip.svelte';

	export let status: ScoreStatus;
	export let tooltip: string;
	export let testId = '';

	const TONE: Record<ScoreStatus, string> = {
		good: 'border-green-800 bg-green-100 text-green-950 dark:border-green-200 dark:bg-green-950 dark:text-green-100',
		ok: 'border-amber-800 bg-amber-100 text-amber-950 dark:border-amber-200 dark:bg-amber-950 dark:text-amber-100',
		weak: 'border-red-800 bg-red-100 text-red-950 dark:border-red-200 dark:bg-red-950 dark:text-red-100'
	};
</script>

<span
	class="inline-flex items-center rounded border px-1 py-0.5 text-[10px] font-bold uppercase leading-none tracking-wide {TONE[status]}"
	data-testid={testId || undefined}
>
	<Tooltip text={STATUS_LABEL[status]} content={tooltip} inheritColor={true} />
</span>
