/**
 * Hashed SvelteKit files under _app/immutable/ are safe to cache forever,
 * and unsafe to delete the moment a new deploy goes out. A browser can still
 * be holding the previous index.html. Keep replaced hashes for `retainMs`,
 * then drop them.
 */

export const DEFAULT_RETAIN_MS = 14 * 24 * 60 * 60 * 1000;
export const IMMUTABLE_PREFIX = '_app/immutable/';

/**
 * @param {{ key: string, lastModified: string | number | Date }[]} remote
 * @param {string[]} currentKeys keys present in this build
 * @param {number} now epoch ms
 * @param {number} retainMs
 * @returns {string[]}
 */
export function keysToPrune(remote, currentKeys, now = Date.now(), retainMs = DEFAULT_RETAIN_MS) {
	const keep = new Set(currentKeys);
	const cutoff = now - retainMs;
	const doomed = [];
	for (const item of remote) {
		if (!item || typeof item.key !== 'string' || !item.key.startsWith(IMMUTABLE_PREFIX)) continue;
		if (keep.has(item.key)) continue;
		const modified = new Date(item.lastModified).getTime();
		if (!Number.isFinite(modified) || modified > cutoff) continue;
		doomed.push(item.key);
	}
	return doomed;
}
