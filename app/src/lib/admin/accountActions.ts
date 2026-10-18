export const ADMINISTRATOR_ROLE = 'Administrator';

/** Shown for an account with no roles document. This label is not stored. */
export const REGULAR_USER_LABEL = 'User';

export const ROLES_COLLECTION = 'roles';
export const ACCOUNT_CONTROL_COLLECTION = 'adminUsers';
export const USERS_COLLECTION = 'users';

/** Roles an administrator can assign from the app. Add names here as they gain meaning. */
export const ASSIGNABLE_ROLES = [ADMINISTRATOR_ROLE] as const;

const ROLE_PATTERN = /^[A-Za-z][A-Za-z0-9 ]{0,62}$/;

export const SELF_ROLE_REASON = 'You can\'t change your own role.';
export const SELF_STATUS_REASON = 'You can\'t disable your own account.';
export const DELETE_LATER_REASON = 'Deleting a user is not available. Disable the account instead.';

export type RoleDocument = {
	role: string;
	updatedAt: string;
	updatedBy: string;
};

export type AccountControlDocument = {
	disabled: boolean;
	disabledAt: string | null;
	disabledBy: string | null;
};

/**
 * Auth deletion is not implemented. The Cloud Function on adminUsers/{uid}
 * only enables or disables the existing Auth user. The browser does not write
 * this, and there is no deletion queue.
 */
export type FutureAuthDeletion = {
	type: 'deleteAuthUser';
	uid: string;
	requestedBy: string;
	requestedAt: string;
};

export type AccountOperation =
	| { type: 'setRole'; uid: string; role: string | null; updatedAt: string; updatedBy: string }
	| ({ type: 'setDisabled'; uid: string } & AccountControlDocument)
	| FutureAuthDeletion;

export type PlanResult = { ok: true; operation: AccountOperation } | { ok: false; reason: string };

export function planSetRole(input: {
	actorUid: string;
	targetUid: string;
	role: string | null;
	now: string;
}): PlanResult {
	if (!input.actorUid || !input.targetUid) {
		return { ok: false, reason: 'A signed-in administrator and a target user are required.' };
	}
	if (input.actorUid === input.targetUid) {
		return { ok: false, reason: SELF_ROLE_REASON };
	}
	const trimmed = (input.role ?? '').trim();
	if (trimmed === '' || trimmed === REGULAR_USER_LABEL) {
		return {
			ok: true,
			operation: {
				type: 'setRole',
				uid: input.targetUid,
				role: null,
				updatedAt: input.now,
				updatedBy: input.actorUid
			}
		};
	}
	if (!ROLE_PATTERN.test(trimmed)) {
		return { ok: false, reason: 'Role names must start with a letter and stay under 64 characters.' };
	}
	return {
		ok: true,
		operation: {
			type: 'setRole',
			uid: input.targetUid,
			role: trimmed,
			updatedAt: input.now,
			updatedBy: input.actorUid
		}
	};
}

export function planSetDisabled(input: {
	actorUid: string;
	targetUid: string;
	disabled: boolean;
	now: string;
}): PlanResult {
	if (!input.actorUid || !input.targetUid) {
		return { ok: false, reason: 'A signed-in administrator and a target user are required.' };
	}
	if (input.actorUid === input.targetUid) {
		return { ok: false, reason: SELF_STATUS_REASON };
	}
	if (input.disabled) {
		return {
			ok: true,
			operation: {
				type: 'setDisabled',
				uid: input.targetUid,
				disabled: true,
				disabledAt: input.now,
				disabledBy: input.actorUid
			}
		};
	}
	return {
		ok: true,
		operation: {
			type: 'setDisabled',
			uid: input.targetUid,
			disabled: false,
			disabledAt: null,
			disabledBy: null
		}
	};
}

export function planDeleteAuthUser(input: {
	actorUid: string;
	targetUid: string;
	now: string;
}): PlanResult {
	if (input.actorUid && input.targetUid && input.actorUid === input.targetUid) {
		return { ok: false, reason: SELF_STATUS_REASON };
	}
	return { ok: false, reason: DELETE_LATER_REASON };
}

export function userMatchesSearch(user: { email: string; displayName: string }, query: string): boolean {
	const needle = query.trim().toLowerCase();
	if (!needle) return true;
	return user.email.toLowerCase().includes(needle) || user.displayName.toLowerCase().includes(needle);
}

export function roleChoices(current: string | null): string[] {
	const choices: string[] = [REGULAR_USER_LABEL, ...ASSIGNABLE_ROLES];
	if (current && !choices.includes(current)) choices.push(current);
	return choices;
}
