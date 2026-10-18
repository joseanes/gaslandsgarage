import { getAuth } from 'firebase-admin/auth';

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) return String(error.code);
  return '';
}

function isUserNotFound(error: unknown): boolean {
  return errorCode(error) === 'auth/user-not-found';
}

/**
 * Applies the `adminUsers/{uid}` disabled flag to Firebase Auth.
 * A disable also revokes refresh tokens. An enable clears the Auth flag.
 * This never deletes the Auth user or their Firestore data.
 */
export async function applyAuthDisabled(uid: string, disabled: boolean): Promise<void> {
  if (!uid) return;
  const auth = getAuth();
  try {
    if (disabled) {
      await auth.updateUser(uid, { disabled: true });
      await auth.revokeRefreshTokens(uid);
      return;
    }
    await auth.updateUser(uid, { disabled: false });
  } catch (error) {
    if (isUserNotFound(error)) {
      console.warn(`Auth user ${uid} was not found. The Auth user was not created or deleted.`);
      return;
    }
    throw error;
  }
}

/**
 * `before` and `after` are the document bodies. `null` means the document
 * did not exist. Deleting `adminUsers/{uid}` does not delete or disable the
 * Auth user. An unchanged flag is left alone.
 */
export async function handleAdminUsersWrite(
  uid: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): Promise<void> {
  if (!uid || after === null) return;
  const afterDisabled = after.disabled === true;
  if (before && (before.disabled === true) === afterDisabled) return;
  await applyAuthDisabled(uid, afterDisabled);
}
