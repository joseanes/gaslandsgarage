import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const appEnv = fileURLToPath(new URL('./src/test-app-env.ts', import.meta.url));

export default defineConfig({
  plugins: [svelte()],
  test: {
    include: ['src/**/*.{test,spec}.{js,ts}'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{js,ts,svelte}'],
      exclude: [
        'src/**/*.{test,spec}.{js,ts}',
        'src/app.d.ts',
        '**/node_modules/**',
      ],
    },
  },
  resolve: {
    // Svelte 5's server entry has no mount(). Component tests need the browser build.
    conditions: ['browser'],
    alias: [
      { find: '$app/env', replacement: appEnv },
      { find: '$lib', replacement: '/src/lib' },
      { find: '$app', replacement: '/node_modules/@sveltejs/kit/src/runtime/app' }
    ],
  },
});