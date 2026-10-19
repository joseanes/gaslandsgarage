import { describe, expect, it } from 'vitest';
import { cloudFunctionUrl, firebaseConfigFor, firebaseEnvironment } from './firebaseConfig';

describe('firebaseConfig', () => {
	it('defaults to production unless staging is requested explicitly', () => {
		expect(firebaseEnvironment(undefined)).toBe('production');
		expect(firebaseEnvironment('production')).toBe('production');
		expect(firebaseEnvironment('Staging')).toBe('production');
		expect(firebaseEnvironment('staging')).toBe('staging');
		expect(firebaseConfigFor(undefined).projectId).toBe('gaslandsgarage-74ce6');
	});

	it('keeps staging on its own project, bucket and auth domain', () => {
		const staging = firebaseConfigFor('staging');
		expect(staging.projectId).toBe('gaslandsgarage-staging');
		expect(staging.storageBucket).toBe('gaslandsgarage-staging.firebasestorage.app');
		expect(staging.authDomain).toBe('gaslandsgarage-staging.firebaseapp.com');
		expect(staging.measurementId).toBeUndefined();
		expect(staging.apiKey).not.toBe(firebaseConfigFor('production').apiKey);
	});

	it('builds project-scoped function URLs', () => {
		expect(cloudFunctionUrl('x', 'staging')).toBe('https://us-central1-gaslandsgarage-staging.cloudfunctions.net/x');
		expect(cloudFunctionUrl('x', undefined)).toBe('https://us-central1-gaslandsgarage-74ce6.cloudfunctions.net/x');
	});
});
