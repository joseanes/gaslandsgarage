/** Types for the buddy-invite signer. The app does not depend on `@types/node`. */
declare module 'node:crypto' {
	interface Hash {
		update(data: string): Hash;
		digest(encoding: 'hex' | 'base64url'): string;
	}

	export function createHash(algorithm: 'sha256'): Hash;
	export function createHmac(algorithm: 'sha256', key: string): Hash;
	export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
}
