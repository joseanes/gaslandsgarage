/** Vitest stand-in for `$app/env`. The real module is provided by SvelteKit at build time. */
export const browser = typeof window !== 'undefined';
export const dev = true;
export const building = false;
export const version = 'test';
