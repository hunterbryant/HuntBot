export function parseRgba01(css: string): { r: number; g: number; b: number; a: number } | null {
	const comma = css.match(
		/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/
	);
	if (comma) {
		return {
			r: Number(comma[1]) / 255,
			g: Number(comma[2]) / 255,
			b: Number(comma[3]) / 255,
			a: comma[4] !== undefined ? Number(comma[4]) : 1
		};
	}
	const space = css.match(/rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.%]+))?\s*\)/);
	if (space) {
		const aStr = space[4];
		let a = 1;
		if (aStr !== undefined) {
			a = aStr.endsWith('%') ? Number(aStr.slice(0, -1)) / 100 : Number(aStr);
		}
		return {
			r: Number(space[1]) / 255,
			g: Number(space[2]) / 255,
			b: Number(space[3]) / 255,
			a
		};
	}
	return null;
}

/** Walk ancestors until a non-transparent `color` is found (handles `text-transparent` on the wrapper). */
export function resolveForegroundRgb01(el: HTMLElement): [number, number, number] {
	let cur: HTMLElement | null = el;
	for (let i = 0; i < 8 && cur; i++) {
		const p = parseRgba01(getComputedStyle(cur).color);
		if (p && p.a > 0.04) return [p.r, p.g, p.b];
		cur = cur.parentElement;
	}
	return [0.09, 0.09, 0.09];
}

/** Parse `getComputedStyle(...).color` into linear 0–1 RGB (good enough for canvas). */
export function cssColorToRgb01(css: string): [number, number, number] {
	const probe = document.createElement('span');
	probe.style.color = css;
	document.documentElement.appendChild(probe);
	const resolved = getComputedStyle(probe).color;
	probe.remove();
	const m = resolved.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
	if (!m) return [0.14, 0.14, 0.14];
	return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255];
}
