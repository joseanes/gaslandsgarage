import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte({ hot: !process.env.VITEST })],
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
    alias: {
      $lib: '/src/lib',
      $app: '/node_modules/@sveltejs/kit/src/runtime/app',
    },
  },
});