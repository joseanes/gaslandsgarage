// US Census Bureau 2024 Gazetteer ZCTA internal points, rounded to 0.01 degrees
// before this file is shipped. Census gazetteer data is public domain.
// ZIP lookups stay in the browser: the code is not sent to a geocoder.

type CentroidTable = Record<string, [number, number]>;

let pending: Promise<CentroidTable> | null = null;

function loadTable(): Promise<CentroidTable> {
	pending ??= import('./zipCentroids.json').then((mod) => mod.default as unknown as CentroidTable);
	return pending;
}

export async function lookupZip(zip: string): Promise<{ lat: number; lng: number } | null> {
	const row = (await loadTable())[zip];
	if (!row) return null;
	return { lat: row[0] / 100, lng: row[1] / 100 };
}
