import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['rules/storage.rules.test.ts'],
		fileParallelism: false,
		hookTimeout: 120_000,
		testTimeout: 30_000
	}
});
