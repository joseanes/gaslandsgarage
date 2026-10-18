import * as fs from 'fs';
import * as path from 'path';

const PAGE_FILES = new Set([
	'+page.svelte',
	'+page.js',
	'+page.ts',
	'+page.server.js',
	'+page.server.ts'
]);

const STATIC_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

type Segment =
	| { kind: 'static'; value: string }
	| { kind: 'param' }
	| { kind: 'optional' }
	| { kind: 'rest' };

/**
 * Paths the CloudFront viewer function should serve as the SPA.
 * Reads SvelteKit pages under `app/src/routes`. `/` is omitted because the
 * function redirects it to `/builder`. Parent paths are included, so
 * `/admin/users` also covers `/admin`. A dot in the last segment is still
 * treated as a file by the function, not as one of these routes.
 */
export function discoverSpaRoutes(routesDir: string): string[] {
	const patterns = new Set<string>();
	walk(routesDir, [], patterns);
	for (const pattern of [...patterns]) {
		for (const ancestor of ancestors(pattern)) patterns.add(ancestor);
	}
	patterns.delete('/');
	return [...patterns].sort();
}

function walk(dir: string, segments: Segment[], patterns: Set<string>): void {
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	if (entries.some((entry) => entry.isFile() && PAGE_FILES.has(entry.name))) {
		for (const pattern of expand(segments)) patterns.add(pattern);
	}
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const segment = classify(entry.name);
		if (segment === 'skip') continue;
		const next = segment === 'group' ? segments : [...segments, segment];
		walk(path.join(dir, entry.name), next, patterns);
	}
}

function classify(name: string): Segment | 'group' | 'skip' {
	if (name.startsWith('(') && name.endsWith(')') && name.length > 2) return 'group';
	if (name.startsWith('[...') && name.endsWith(']') && name.length > 5) return { kind: 'rest' };
	if (name.startsWith('[[') && name.endsWith(']]') && name.length > 4) return { kind: 'optional' };
	if (name.startsWith('[') && name.endsWith(']') && name.length > 2) return { kind: 'param' };
	if (STATIC_SEGMENT.test(name)) return { kind: 'static', value: name };
	return 'skip';
}

function expand(segments: Segment[]): string[] {
	let options: string[][] = [[]];
	for (const segment of segments) {
		if (options.some((parts) => parts[parts.length - 1] === ':r*')) {
			throw new Error('A rest parameter has to be the last segment of a SvelteKit route');
		}
		if (segment.kind === 'optional') {
			options = [...options, ...options.map((parts) => [...parts, ':p'])];
			continue;
		}
		const token = segment.kind === 'static' ? segment.value : segment.kind === 'param' ? ':p' : ':r*';
		options = options.map((parts) => [...parts, token]);
	}
	return options.map((parts) => (parts.length ? `/${parts.join('/')}` : '/'));
}

function ancestors(pattern: string): string[] {
	const parts = pattern.split('/').filter(Boolean);
	const found: string[] = [];
	for (let i = 1; i < parts.length; i += 1) {
		const slice = parts.slice(0, i);
		if (slice.some((part) => part.startsWith(':'))) break;
		found.push(`/${slice.join('/')}`);
	}
	return found;
}
