import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DELETE_CONFIRMATION, privacyErrorMessage } from './accountShared';

describe('account client', () => {
	it('uses the same confirmation word as the Cloud Function', () => {
		const source = readFileSync(path.resolve(process.cwd(), '../functions/src/accountPrivacy.ts'), 'utf8');
		expect(source).toContain(`DELETE_CONFIRMATION = '${DELETE_CONFIRMATION}'`);
		expect(DELETE_CONFIRMATION).toBe('DELETE');
	});

	it('explains a cancelled sign-in without claiming the account was deleted', () => {
		expect(privacyErrorMessage({ code: 'auth/popup-closed-by-user', message: 'closed' })).toBe(
			'Sign-in was cancelled. Your account was not deleted.'
		);
		expect(privacyErrorMessage({ code: 'functions/resource-exhausted', message: 'Too many requests. Try again later.' })).toBe(
			'Too many requests. Try again in an hour.'
		);
		expect(privacyErrorMessage({ code: 'functions/failed-precondition', message: 'Type DELETE to confirm account deletion.' })).toBe(
			'Type DELETE to confirm account deletion.'
		);
	});
});
