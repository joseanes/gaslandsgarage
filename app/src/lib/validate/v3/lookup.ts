export function resolveById<T extends { id: string }>(
	items: readonly T[],
	instanceId: unknown
): T | undefined {
	if (typeof instanceId !== 'string' || !instanceId) return undefined;
	const exact = items.find((item) => item.id === instanceId);
	if (exact) return exact;
	const lower = instanceId.toLowerCase();
	const folded = items.find((item) => item.id.toLowerCase() === lower);
	if (folded) return folded;
	const parts = instanceId.split('_');
	for (let i = parts.length - 1; i >= 1; i--) {
		const candidate = parts.slice(0, i).join('_');
		const candidateLower = candidate.toLowerCase();
		const match = items.find((item) => item.id === candidate || item.id.toLowerCase() === candidateLower);
		if (match) return match;
	}
	return undefined;
}
