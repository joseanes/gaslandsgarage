import { describe, expect, it } from 'vitest';
import {
	ADMINISTRATOR_ROLE,
	DELETE_LATER_REASON,
	REGULAR_USER_LABEL,
	SELF_ROLE_REASON,
	SELF_STATUS_REASON,
	planDeleteAuthUser,
	planSetDisabled,
	planSetRole,
	roleChoices,
	userMatchesSearch
} from './accountActions';

const now = '2026-10-17T12:00:00.000Z';

describe('planSetRole', () => {
	it('stores Administrator and clears a role back to a regular user', () => {
		const grant = planSetRole({ actorUid: 'admin', targetUid: 'player', role: ADMINISTRATOR_ROLE, now });
		expect(grant).toEqual({
			ok: true,
			operation: {
				type: 'setRole',
				uid: 'player',
				role: ADMINISTRATOR_ROLE,
				updatedAt: now,
				updatedBy: 'admin'
			}
		});

		const clear = planSetRole({ actorUid: 'admin', targetUid: 'player', role: REGULAR_USER_LABEL, now });
		expect(clear.ok && clear.operation.type === 'setRole' && clear.operation.role).toBeNull();
		expect(planSetRole({ actorUid: 'admin', targetUid: 'player', role: '  ', now }).ok).toBe(true);
	});

	it('refuses a self role change and a role name the rules would reject', () => {
		expect(planSetRole({ actorUid: 'admin', targetUid: 'admin', role: REGULAR_USER_LABEL, now })).toEqual({
			ok: false,
			reason: SELF_ROLE_REASON
		});
		expect(planSetRole({ actorUid: 'admin', targetUid: 'player', role: '9 lives', now }).ok).toBe(false);
		expect(planSetRole({ actorUid: '', targetUid: 'player', role: ADMINISTRATOR_ROLE, now }).ok).toBe(false);
	});

	it('accepts a future role name without treating it as Administrator', () => {
		const plan = planSetRole({ actorUid: 'admin', targetUid: 'player', role: 'Marshal', now });
		expect(plan.ok && plan.operation.type === 'setRole' && plan.operation.role).toBe('Marshal');
		expect(roleChoices('Marshal')).toEqual([REGULAR_USER_LABEL, ADMINISTRATOR_ROLE, 'Marshal']);
	});
});

describe('planSetDisabled', () => {
	it('writes the disable flag and clears it on re-enable', () => {
		expect(planSetDisabled({ actorUid: 'admin', targetUid: 'player', disabled: true, now })).toEqual({
			ok: true,
			operation: {
				type: 'setDisabled',
				uid: 'player',
				disabled: true,
				disabledAt: now,
				disabledBy: 'admin'
			}
		});
		expect(planSetDisabled({ actorUid: 'admin', targetUid: 'player', disabled: false, now })).toEqual({
			ok: true,
			operation: {
				type: 'setDisabled',
				uid: 'player',
				disabled: false,
				disabledAt: null,
				disabledBy: null
			}
		});
	});

	it('refuses to disable the signed-in administrator', () => {
		expect(planSetDisabled({ actorUid: 'admin', targetUid: 'admin', disabled: true, now })).toEqual({
			ok: false,
			reason: SELF_STATUS_REASON
		});
	});
});

describe('planDeleteAuthUser', () => {
	it('stays unavailable until a Blaze Cloud Function exists', () => {
		expect(planDeleteAuthUser({ actorUid: 'admin', targetUid: 'player', now }).ok).toBe(false);
		expect(planDeleteAuthUser({ actorUid: 'admin', targetUid: 'player', now })).toEqual({
			ok: false,
			reason: DELETE_LATER_REASON
		});
		const self = planDeleteAuthUser({ actorUid: 'admin', targetUid: 'admin', now });
		expect(self.ok).toBe(false);
		if (!self.ok) expect(self.reason).toBe(SELF_STATUS_REASON);
	});
});

describe('userMatchesSearch', () => {
	const user = { email: 'Ada@Example.com', displayName: 'Ada Lovelace' };

	it('matches email or display name and keeps an empty query', () => {
		expect(userMatchesSearch(user, '')).toBe(true);
		expect(userMatchesSearch(user, ' ada@ ')).toBe(true);
		expect(userMatchesSearch(user, 'lovelace')).toBe(true);
		expect(userMatchesSearch(user, 'missing')).toBe(false);
	});
});
