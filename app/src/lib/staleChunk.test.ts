import { describe, expect, it, vi } from 'vitest';
import { CHUNK_RELOAD_GRACE_MS, CHUNK_RELOAD_KEY, clearStaleChunkReload, installStaleChunkReload, type ChunkReloadHost } from './staleChunk';

function host(initial: Record<string, string> = {}) {
	const storage = { ...initial };
	const listeners = new Map<string, (event: Event) => void>();
	let timer: (() => void) | undefined;
	const reload = vi.fn();
	const fake: ChunkReloadHost = {
		sessionStorage: {
			getItem: (key) => storage[key] ?? null,
			setItem: (key, value) => {
				storage[key] = value;
			},
			removeItem: (key) => {
				delete storage[key];
			}
		},
		addEventListener: (type, listener) => {
			listeners.set(type, listener);
		},
		setTimeout: (handler) => {
			timer = handler;
			return 1;
		},
		location: { reload }
	};
	return {
		fake,
		storage,
		reload,
		fire() {
			const event = new Event('vite:preloadError', { cancelable: true });
			listeners.get('vite:preloadError')?.(event);
			return event;
		},
		age() {
			timer?.();
		}
	};
}

describe('installStaleChunkReload', () => {
	it('reloads once when a hashed chunk fails to preload', () => {
		const page = host();
		installStaleChunkReload(page.fake);

		const first = page.fire();
		expect(first.defaultPrevented).toBe(true);
		expect(page.storage[CHUNK_RELOAD_KEY]).toBe('1');
		expect(page.reload).toHaveBeenCalledTimes(1);

		const second = page.fire();
		expect(second.defaultPrevented).toBe(false);
		expect(page.reload).toHaveBeenCalledTimes(1);
	});

	it('does not reload again when this tab already recovered', () => {
		const page = host({ [CHUNK_RELOAD_KEY]: '1' });
		installStaleChunkReload(page.fake);
		const event = page.fire();
		expect(event.defaultPrevented).toBe(false);
		expect(page.reload).not.toHaveBeenCalled();
	});

	it('clears the flag after a healthy page so a later deploy can recover', () => {
		const page = host({ [CHUNK_RELOAD_KEY]: '1' });
		installStaleChunkReload(page.fake);
		expect(CHUNK_RELOAD_GRACE_MS).toBeGreaterThan(0);
		page.age();
		expect(page.storage[CHUNK_RELOAD_KEY]).toBeUndefined();
	});

	it('keeps the flag when this page already saw a chunk error', () => {
		const page = host();
		installStaleChunkReload(page.fake);
		page.fire();
		page.age();
		expect(page.storage[CHUNK_RELOAD_KEY]).toBe('1');
	});

	it('registers a single listener', () => {
		const page = host();
		installStaleChunkReload(page.fake);
		installStaleChunkReload(page.fake);
		page.fire();
		expect(page.reload).toHaveBeenCalledTimes(1);
	});
});

describe('clearStaleChunkReload', () => {
	it('drops the flag so Try again can reload', () => {
		const storage: Record<string, string> = { [CHUNK_RELOAD_KEY]: '1' };
		clearStaleChunkReload({
			removeItem: (key) => {
				delete storage[key];
			}
		});
		expect(storage[CHUNK_RELOAD_KEY]).toBeUndefined();
	});
});
