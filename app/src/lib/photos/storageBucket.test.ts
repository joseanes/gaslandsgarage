import { describe, expect, it } from 'vitest';
import { DEFAULT_STORAGE_BUCKET, STAGING_STORAGE_BUCKET, storageBucketForProject } from './model';

describe('storageBucketForProject', () => {
	it('prefers an explicit bucket', () => {
		expect(storageBucketForProject(' custom ', 'gaslandsgarage-staging')).toBe('custom');
	});
	it('uses the staging bucket only for the staging project', () => {
		expect(storageBucketForProject('', 'gaslandsgarage-staging')).toBe(STAGING_STORAGE_BUCKET);
		expect(storageBucketForProject('', 'gaslandsgarage-74ce6')).toBe(DEFAULT_STORAGE_BUCKET);
		expect(storageBucketForProject('', 'demo-gaslands-functions')).toBe(DEFAULT_STORAGE_BUCKET);
		expect(storageBucketForProject()).toBe(DEFAULT_STORAGE_BUCKET);
	});
});
