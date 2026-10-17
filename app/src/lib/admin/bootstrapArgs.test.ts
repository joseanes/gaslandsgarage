import { describe, expect, it } from 'vitest';
import { parseSetAdminArgs } from './bootstrapArgs';

describe('parseSetAdminArgs', () => {
	it('reads the email flag', () => {
		expect(parseSetAdminArgs(['--email', 'admin@example.com'])).toEqual({ email: 'admin@example.com' });
	});

	it('rejects a missing email', () => {
		expect(() => parseSetAdminArgs([])).toThrow(/--email/);
		expect(() => parseSetAdminArgs(['--email', '--role'])).toThrow(/--email/);
	});
});
