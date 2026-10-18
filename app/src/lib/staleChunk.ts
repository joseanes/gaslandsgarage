/** Session flag: this tab already reloaded once after a missing hashed chunk. */
export const CHUNK_RELOAD_KEY = 'gaslands-chunk-reload';

/** A healthy page clears the flag so the next deploy can recover once. */
export const CHUNK_RELOAD_GRACE_MS = 8000;

const INSTALLED = '__gaslandsStaleChunkReload';

export interface ChunkReloadHost {
	sessionStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
	addEventListener(type: string, listener: (event: Event) => void): void;
	setTimeout(handler: () => void, timeout: number): number;
	location: { reload(): void };
}

/**
 * A stale index.html asks for hashed files the latest deploy removed.
 * Reload once so the browser picks up the new index. A second failure
 * stays on the page so the vehicle list can show its own error.
 * preventDefault only on that first reload: Vite swallows the import
 * rejection when the event is cancelled, and the list needs the rejection
 * in order to render {:catch}.
 */
export function installStaleChunkReload(host: ChunkReloadHost = window): void {
	const tagged = host as ChunkReloadHost & { [INSTALLED]?: boolean };
	if (tagged[INSTALLED]) return;
	tagged[INSTALLED] = true;

	let sawChunkError = false;
	host.addEventListener('vite:preloadError', (event) => {
		sawChunkError = true;
		let alreadyReloaded = false;
		try {
			alreadyReloaded = host.sessionStorage.getItem(CHUNK_RELOAD_KEY) === '1';
		} catch {
			return;
		}
		if (alreadyReloaded) return;

		event.preventDefault();
		try {
			host.sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
		} catch {
			// Private mode can reject storage. Still reload once.
		}
		host.location.reload();
	});

	host.setTimeout(() => {
		if (sawChunkError) return;
		try {
			host.sessionStorage.removeItem(CHUNK_RELOAD_KEY);
		} catch {
			// Ignore storage failures. The flag simply stays until the tab closes.
		}
	}, CHUNK_RELOAD_GRACE_MS);
}

export function clearStaleChunkReload(storage: Pick<Storage, 'removeItem'> | undefined = globalThis.sessionStorage): void {
	try {
		storage?.removeItem(CHUNK_RELOAD_KEY);
	} catch {
		// Ignore storage failures. Reload still fetches a fresh document.
	}
}
