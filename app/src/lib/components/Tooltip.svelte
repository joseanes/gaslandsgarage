<script lang="ts">
  import { onMount } from 'svelte';
  
  export let text = '';
  export let content = '';
  /** Use the surrounding text color instead of the default amber trigger. */
  export let inheritColor = false;
  
  let tooltipElement: HTMLElement | undefined;
  let tooltipContent: HTMLElement | undefined;
  let position = { top: 0, left: 0 };
  let showTooltip = false;
  
  let positioningTimeout: ReturnType<typeof setTimeout> | undefined;
  
  function positionTooltip() {
    if (!tooltipElement || !tooltipContent) return;
    
    // Clear any existing timeout to prevent cascading updates
    if (positioningTimeout) clearTimeout(positioningTimeout);
    
    const rect = tooltipElement.getBoundingClientRect();
    const tooltipRect = tooltipContent.getBoundingClientRect();
    
    // Create a new position object to avoid reactive updates if values are the same
    const newPosition = {
      left: rect.left + rect.width / 2 - tooltipRect.width / 2,
      top: rect.top - tooltipRect.height - 10
    };
    
    // Adjust if tooltip would appear off-screen
    if (newPosition.left < 10) {
      newPosition.left = 10;
    } else if (newPosition.left + tooltipRect.width > window.innerWidth - 10) {
      newPosition.left = window.innerWidth - tooltipRect.width - 10;
    }
    
    if (newPosition.top < 10) {
      // If tooltip would appear above the viewport, position it below the element
      newPosition.top = rect.bottom + 10;
    }
    
    // Only update if position has actually changed
    if (newPosition.left !== position.left || newPosition.top !== position.top) {
      position = newPosition;
    }
  }
  
  function handleMouseEnter() {
    showTooltip = true;
    // Delay positioning to ensure the tooltip is rendered first
    positioningTimeout = setTimeout(positionTooltip, 10);
  }
  
  function handleMouseLeave() {
    showTooltip = false;
  }
  
  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      showTooltip = !showTooltip;
      if (showTooltip) {
        // Use the managed positioning timeout
        if (positioningTimeout) clearTimeout(positioningTimeout);
        positioningTimeout = setTimeout(positionTooltip, 10);
      }
    }
    if (event.key === 'Escape' && showTooltip) {
      showTooltip = false;
    }
  }
  
  // Event handlers for scroll and resize
  function handleScroll() {
    if (showTooltip) positionTooltip();
  }
  
  function handleResize() {
    if (showTooltip) positionTooltip();
  }
  
  onMount(() => {
    // Add event listeners
    window.addEventListener('scroll', handleScroll);
    window.addEventListener('resize', handleResize);
    
    // Return cleanup function
    return () => {
      // Clear any pending timeout on unmount
      if (positioningTimeout) clearTimeout(positioningTimeout);
      
      // Remove event listeners
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
    };
  });
</script>

<span 
  bind:this={tooltipElement}
  class="tooltip-trigger"
  class:inherit={inheritColor}
  on:mouseenter={handleMouseEnter}
  on:mouseleave={handleMouseLeave}
  on:keydown={handleKeyDown}
  role="button"
  tabindex="0"
  aria-expanded={showTooltip}
  aria-label="Show information about {text}"
>
  {text}
  
  {#if showTooltip}
    <div 
      bind:this={tooltipContent}
      class="tooltip-content"
      style="left: {position.left}px; top: {position.top}px;"
      role="tooltip"
      aria-live="polite"
    >
      <div class="tooltip-arrow"></div>
      <div class="tooltip-inner">
        {#if content.includes('<p>') || content.includes('<strong>')}
          {@html content}
        {:else}
          {content}
        {/if}
      </div>
    </div>
  {/if}
</span>

<style>
  .tooltip-trigger {
    position: relative;
    display: inline-block;
    cursor: help;
    text-decoration: underline;
    text-decoration-style: dotted;
    text-decoration-thickness: 1px;
    text-underline-offset: 2px;
    color: #92400e; /* amber-800: amber-600 is under 4.5:1 on the stone card */
    font-weight: 500;
  }
  
  .tooltip-trigger:hover {
    color: #f59e0b; /* amber-500 */
  }

  .tooltip-trigger.inherit,
  .tooltip-trigger.inherit:hover {
    color: inherit;
    font-weight: inherit;
  }
  
  .tooltip-content {
    position: fixed;
    z-index: 9999;
    pointer-events: none;
  }
  
  .tooltip-inner {
    background-color: #1f2937; /* dark gray-800 */
    color: white;
    text-align: left;
    padding: 8px 12px;
    border-radius: 6px;
    width: 300px;
    max-width: 80vw;
    font-size: 0.85rem;
    line-height: 1.4;
    font-weight: normal;
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
    border: 1px solid #f59e0b; /* amber-500 */
  }
  
  .tooltip-arrow {
    position: absolute;
    width: 0;
    height: 0;
    border-left: 8px solid transparent;
    border-right: 8px solid transparent;
    border-top: 8px solid #1f2937;
    bottom: -8px;
    left: 50%;
    transform: translateX(-50%);
  }
</style>