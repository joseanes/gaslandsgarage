<script>
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { builderPathForTeamAction, isTeamMenuAction, TEAM_MENU_ACTION_KEY } from '$lib/teamMenu';

  // Auto-redirect to builder. A pending Teams action keeps its open= query.
  // Playwright sets data-hold-home so it can click the menu on this page first.
  onMount(() => {
    if (document.documentElement.hasAttribute('data-hold-home')) return;
    if (window.location.pathname !== '/') return;
    const open = new URLSearchParams(window.location.search).get('open');
    const stored = sessionStorage.getItem(TEAM_MENU_ACTION_KEY);
    const action = isTeamMenuAction(open) ? open : isTeamMenuAction(stored) ? stored : null;
    goto(action ? builderPathForTeamAction(action) : '/builder');
  });
</script>

<!-- Simple loading/redirecting message -->
<div class="flex items-center justify-center h-screen">
  <div class="text-center">
    <h1 class="text-xl font-bold mb-4">
      <span class="text-amber-500">Redirecting to Gaslands Garage...</span>
    </h1>
    <div class="inline-block w-8 h-8 border-4 border-t-amber-500 border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin"></div>
  </div>
</div>
