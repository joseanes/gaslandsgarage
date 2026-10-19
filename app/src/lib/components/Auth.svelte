<script lang="ts">
  import { user, signInWithGoogle, signOutUser } from '$lib/firebase';
  import { clampToViewport } from '$lib/clampToViewport';
  import { onMount, tick } from 'svelte';
  import { fade } from 'svelte/transition';
  
  let showDropdown = false;
  let isLoading = false;
  
  // Handle Google sign in
  const handleSignIn = async () => {
    isLoading = true;
    const result = await signInWithGoogle();
    isLoading = false;
    if (!result.success) {
      alert('Failed to sign in with Google. Please try again.');
    }
    showDropdown = false;
  };
  
  // Handle sign out
  const handleSignOut = async () => {
    isLoading = true;
    const result = await signOutUser();
    isLoading = false;
    if (!result.success) {
      alert('Failed to sign out. Please try again.');
    }
    showDropdown = false;
  };
  
  // Close dropdown when clicking outside
  onMount(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.auth-container')) {
        showDropdown = false;
      }
    };
    
    document.addEventListener('click', handleClickOutside);
    
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  });
</script>

<div class="auth-container relative z-10">
  {#if $user}
    <!-- User is signed in -->
    <button 
      type="button" 
      class="auth-button signed-in"
      on:click={async () => {
        showDropdown = !showDropdown;
        await tick();
        clampToViewport(document.querySelector('.auth-container .dropdown'));
      }}
      aria-haspopup="true"
      aria-expanded={showDropdown}
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1.5" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd" />
      </svg>
      <span>{$user.displayName?.split(' ')[0] || $user.email?.split('@')[0] || 'Account'}</span>
    </button>
    
    {#if showDropdown}
      <div 
        class="dropdown" 
        transition:fade={{ duration: 150 }}
      >
        <div class="dropdown-header">
          Signed in as <strong>{$user.displayName || $user.email}</strong>
        </div>
        <div class="separator"></div>
        <a href="/buddies" class="dropdown-button" on:click={() => showDropdown = false}>
          Gaming Buddies
        </a>
        <button 
          type="button" 
          class="dropdown-button"
          on:click={handleSignOut}
          disabled={isLoading}
        >
          {isLoading ? 'Signing out...' : 'Sign out'}
        </button>
      </div>
    {/if}
  {:else}
    <!-- User is not signed in -->
    <button 
      type="button"
      class="auth-button sign-in"
      on:click={handleSignIn}
      disabled={isLoading}
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1.5" viewBox="0 0 48 48">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
      </svg>
      <span class="hidden md:inline">{isLoading ? 'Signing in...' : 'Sign in'}</span>
      <span class="md:hidden">Sign in</span>
    </button>
  {/if}
</div>

<style>
  .auth-button {
    display: flex;
    align-items: center;
    font-size: 0.875rem;
    font-weight: 500;
    border-radius: 0.375rem;
    padding: 0.35rem 0.75rem;
    cursor: pointer;
    transition: all 0.2s;
    color: white;
  }
  
  .auth-button.signed-in {
    background-color: rgba(245, 158, 11, 0.2); /* amber with transparency */
    border: 1px solid rgba(245, 158, 11, 0.5);
  }
  
  .auth-button.signed-in:hover {
    background-color: rgba(245, 158, 11, 0.3);
  }
  
  .auth-button.sign-in {
    background-color: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.3);
  }
  
  .auth-button.sign-in:hover {
    background-color: rgba(255, 255, 255, 0.2);
  }
  
  .dropdown {
    position: absolute;
    right: 0;
    top: 40px;
    width: 220px;
    background-color: #111;
    border: 2px solid #333;
    border-radius: 0.375rem;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.7);
    overflow: hidden;
    z-index: 50;
  }
  
  .dropdown-header {
    padding: 0.75rem 1rem;
    font-size: 0.875rem;
    color: #d1d5db;
  }
  
  .dropdown-header strong {
    color: white;
    display: block;
    margin-top: 0.25rem;
    font-size: 0.9375rem;
  }
  
  .separator {
    border-top: 1px solid #333;
    margin: 0.25rem 0;
  }
  
  a.dropdown-button {
    text-decoration: none;
  }

  .dropdown-button {
    display: block;
    width: 100%;
    text-align: left;
    padding: 0.75rem 1rem;
    color: #f59e0b; /* amber */
    font-size: 0.875rem;
    background: transparent;
    border: none;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .dropdown-button:hover {
    background-color: #1f1f1f;
    color: #fcd34d; /* lighter amber */
  }
</style>