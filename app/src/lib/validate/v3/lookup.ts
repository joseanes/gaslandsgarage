export function resolveById<T extends { id: string }>(
	items: readonly T[],
	instanceId: string
): T | undefined {
	const exact = items.find((item) => item.id === instanceId);
	if (exact) return exact;
	const parts = instanceId.split('_');
	for (let i = parts.length - 1; i >= 1; i--) {
		const candidate = parts.slice(0, i).join('_');
		const match = items.find((item) => item.id === candidate);
		if (match) return match;
	}
	return undefined;
}
