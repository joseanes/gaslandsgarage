/** Shift an open menu sideways so it stays inside the viewport. Labels and items stay put. */
export function clampToViewport(menu: Element | null, margin = 8): void {
	if (!(menu instanceof HTMLElement) || typeof window === 'undefined') return;
	menu.style.transform = '';
	const rect = menu.getBoundingClientRect();
	let shift = 0;
	if (rect.right > window.innerWidth - margin) shift = window.innerWidth - margin - rect.right;
	if (rect.left + shift < margin) shift += margin - (rect.left + shift);
	if (shift !== 0) menu.style.transform = `translateX(${Math.round(shift)}px)`;
}
