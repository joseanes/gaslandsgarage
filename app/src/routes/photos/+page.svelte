<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	onMount(() => {
		void goto('/gallery?view=mine', { replaceState: true });
	});
</script>

<p>Opening your photos…</p>
