export function parseSetAdminArgs(argv: string[]): { email: string } {
	const index = argv.indexOf('--email');
	const email = index >= 0 ? argv[index + 1]?.trim() : '';
	if (!email || email.startsWith('--') || !email.includes('@')) {
		throw new Error('Pass --email user@example.com');
	}
	return { email };
}
