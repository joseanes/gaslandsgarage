/** Must match functions/src/accountPrivacy.ts DELETE_CONFIRMATION. */
export const DELETE_CONFIRMATION = 'DELETE';

export const PRIVACY_FUNCTIONS_REGION = 'us-central1';

export function saveJsonDownload(filename: string, value: unknown): void {
	const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}

export function privacyErrorMessage(error: unknown): string {
	const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
	const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
	if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
		return 'Sign-in was cancelled. Your account was not deleted.';
	}
	if (code.endsWith('resource-exhausted')) return 'Too many requests. Try again in an hour.';
	if (
		message &&
		(code.endsWith('failed-precondition') || code.endsWith('unauthenticated') || code.endsWith('invalid-argument'))
	) {
		return message;
	}
	if (message && !code.startsWith('functions/')) return message;
	return 'That did not finish. Your account is still there. Try again.';
}
