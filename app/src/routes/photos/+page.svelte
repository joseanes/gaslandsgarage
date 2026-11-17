<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	onMount(() => {
		void goto('/gallery?view=mine', { replace: true });
	});
</script>

<p>Opening your photos…</p>
