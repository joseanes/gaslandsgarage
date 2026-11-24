import { browser } from '$app/env';
import { page as pageState } from '$app/state';
import { readable, toStore } from 'svelte/store';

/**
 * SvelteKit 3 removed `$app/stores`. `$app/state` only updates rune readers,
 * so the existing `$page` and `$:` code would stay stuck on the first URL.
 * This store publishes a fresh snapshot whenever that state changes.
 */
export type KitPage = {
	url: URL;
	params: Record<string, string>;
	route: { id: string | null };
	status: number;
	error: App.Error | null;
	data: App.PageData;
	state: App.PageState;
	form: unknown;
};

const fallback: KitPage = {
	url: new URL('https://gaslandsgarage.local/'),
	params: {},
	route: { id: null },
	status: 200,
	error: null,
	data: {},
	state: {},
	form: null
};

function snapshot(): KitPage {
	const params: Record<string, string> = {};
	for (const [key, value] of Object.entries(pageState.params)) {
		if (typeof value === 'string') params[key] = value;
	}
	return {
		url: new URL(pageState.url.href),
		params,
		route: { id: pageState.route.id },
		status: pageState.status,
		error: pageState.error,
		data: pageState.data,
		state: pageState.state,
		form: pageState.form
	};
}

export const page = readable(fallback, (set) => {
	if (!browser) return;
	return toStore(snapshot).subscribe(set);
});
