<script lang="ts">
	import { paintingGuideLink } from '$lib/photos/link';

	export let url = '';

	$: guide = paintingGuideLink(url);
</script>

{#if guide}
	<a
		class="guide-link"
		href={guide.href}
		rel="nofollow ugc noopener noreferrer"
		target="_blank"
		data-testid="painting-guide"
	>
		{#if guide.youtube}
			<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
				<path fill="#FF0033" d="M23 12.2s0-3.2-.4-4.6c-.2-.9-.9-1.6-1.8-1.8C19.2 5.4 12 5.4 12 5.4s-7.2 0-8.8.4c-.9.2-1.6.9-1.8 1.8C1 9 1 12.2 1 12.2s0 3.2.4 4.6c.2.9.9 1.6 1.8 1.8 1.6.4 8.8.4 8.8.4s7.2 0 8.8-.4c.9-.2 1.6-.9 1.8-1.8.4-1.4.4-4.6.4-4.6z" />
				<path fill="#fff" d="M9.8 15.5v-6.6l6.2 3.3-6.2 3.3z" />
			</svg>
		{/if}
		{guide.label}
	</a>
{/if}

<style>
	.guide-link {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		margin-top: 0.55rem;
		border-radius: 999px;
		border: 1px solid #c2410c;
		background: #0c0a09;
		color: #ffedd5;
		padding: 0.35rem 0.75rem;
		font-size: 0.85rem;
		font-weight: 750;
		text-decoration: none;
	}
	.guide-link:hover {
		background: #431407;
	}
</style>
