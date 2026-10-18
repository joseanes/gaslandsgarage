import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { discoverSpaRoutes } from '../lib/spa-routes';
import { viewerRequestCode } from '../lib/viewer-request';

const appRoutes = path.join(__dirname, '../../app/src/routes');

type QueryValue = { value?: string; multiValue?: { value: string }[] };
type ViewerResult = {
	statusCode?: number;
	headers?: { location?: { value: string } };
	uri?: string;
	querystring?: Record<string, QueryValue>;
};

function loadHandler(code: string): (event: { request: ViewerResult }) => ViewerResult {
	const handler = new Function(`${code}; return handler;`)() as (event: {
		request: ViewerResult;
	}) => ViewerResult;
	return handler;
}

function run(
	handler: (event: { request: ViewerResult }) => ViewerResult,
	uri: string,
	options?: { host?: string; query?: Record<string, QueryValue> }
): ViewerResult {
	return handler({
		request: {
			uri,
			headers: { host: { value: options?.host ?? 'gaslandsgarage.com' } } as ViewerResult['headers'],
			querystring: options?.query ?? {}
		}
	});
}

describe('SvelteKit route discovery', () => {
	test('lists the app pages and their parent paths', () => {
		expect(discoverSpaRoutes(appRoutes)).toEqual(['/admin', '/admin/users', '/builder', '/players', '/profile', '/stats']);
	});

	test('reads nested, grouped, optional, and dynamic pages from a fixture', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-routes-'));
		const pages = [
			'builder/+page.svelte',
			'teams/+page.ts',
			'player/[id]/+page.svelte',
			'docs/[...slug]/+page.js',
			'(hidden)/secret/+page.svelte',
			'admin/users/+page.server.ts',
			'lang/[[locale]]/about/+page.svelte',
			'builder/+page.svelte.bak-1'
		];
		for (const page of pages) {
			const file = path.join(root, page);
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, '');
		}
		try {
			expect(discoverSpaRoutes(root)).toEqual([
				'/admin',
				'/admin/users',
				'/builder',
				'/docs',
				'/docs/:r*',
				'/lang',
				'/lang/:p/about',
				'/lang/about',
				'/player',
				'/player/:p',
				'/secret',
				'/teams'
			]);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});

describe('viewer-request function', () => {
	const handler = loadHandler(viewerRequestCode(discoverSpaRoutes(appRoutes)));

	function location(result: ViewerResult): string | undefined {
		return result.headers?.location?.value;
	}

	test('rewrites every current app route, including parents, to index.html', () => {
		for (const uri of ['/builder', '/stats', '/admin', '/admin/users', '/players', '/profile']) {
			const result = run(handler, uri, { query: { draft: { value: 'abc' } } });
			expect(result.uri).toBe('/index.html');
			expect(result.statusCode).toBeUndefined();
			expect(result.querystring).toEqual({ draft: { value: 'abc' } });
		}
	});

	test('redirects the apex and trailing slashes, and keeps the query', () => {
		expect(location(run(handler, '/'))).toBe('https://gaslandsgarage.com/builder');
		expect(location(run(handler, '/index.html', { query: { open: { value: 'myteams' } } }))).toBe(
			'https://gaslandsgarage.com/builder?open=myteams'
		);
		expect(location(run(handler, '/admin/users/'))).toBe('https://gaslandsgarage.com/admin/users');
		expect(location(run(handler, '/builder/', { query: { draft: { value: 'abc' } } }))).toBe(
			'https://gaslandsgarage.com/builder?draft=abc'
		);
	});

	test('redirects www to the apex without turning the path into the SPA early', () => {
		expect(location(run(handler, '/admin/users', { host: 'www.gaslandsgarage.com' }))).toBe(
			'https://gaslandsgarage.com/admin/users'
		);
		expect(location(run(handler, '/robots.txt', { host: 'WWW.gaslandsgarage.com' }))).toBe(
			'https://gaslandsgarage.com/robots.txt'
		);
		expect(
			location(
				run(handler, '/', {
					host: 'www.gaslandsgarage.com',
					query: { draft: { multiValue: [{ value: 'one' }, { value: 'two' }] } }
				})
			)
		).toBe('https://gaslandsgarage.com/builder?draft=one&draft=two');
	});

	test('serves static files as-is, including public PDFs', () => {
		for (const uri of [
			'/robots.txt',
			'/sitemap.xml',
			'/404.html',
			'/favicon.ico',
			'/favicon.svg',
			'/icon-512.png',
			'/apple-touch-icon.png',
			'/site.webmanifest',
			'/images/logo.png',
			'/_app/immutable/chunks/index.js',
			'/rules/public-card.pdf'
		]) {
			expect(run(handler, uri).uri).toBe(uri);
		}
	});

	test('leaves unknown paths alone so CloudFront can return 404', () => {
		for (const uri of ['/teams', '/no-such-page', '/beta', '/g3e/rules.pdf', '/admin/nope', '/builder/extra']) {
			const result = run(handler, uri);
			expect(result.uri).toBe(uri);
			expect(result.statusCode).toBeUndefined();
		}
	});

	test('matches dynamic fixture routes and still ignores files', () => {
		const dynamic = loadHandler(
			viewerRequestCode(['/teams', '/player', '/player/:p', '/docs', '/docs/:r*', '/lang/about', '/lang/:p/about'])
		);
		expect(run(dynamic, '/teams').uri).toBe('/index.html');
		expect(run(dynamic, '/player').uri).toBe('/index.html');
		expect(run(dynamic, '/player/abc').uri).toBe('/index.html');
		expect(run(dynamic, '/player/abc/extra').uri).toBe('/player/abc/extra');
		expect(run(dynamic, '/docs/a/b').uri).toBe('/index.html');
		expect(run(dynamic, '/lang/about').uri).toBe('/index.html');
		expect(run(dynamic, '/lang/en/about').uri).toBe('/index.html');
		expect(run(dynamic, '/docs/a/notes.pdf').uri).toBe('/docs/a/notes.pdf');
	});

	test('stays inside the CloudFront function size limit and does not name beta files', () => {
		const code = viewerRequestCode(discoverSpaRoutes(appRoutes));
		expect(Buffer.byteLength(code)).toBeLessThan(10 * 1024);
		expect(code).not.toContain('/beta');
		expect(code.toLowerCase()).not.toContain('g3e');
	});
});
