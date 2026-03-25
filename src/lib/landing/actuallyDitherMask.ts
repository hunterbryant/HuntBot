function parseRgba01(css: string): { r: number; g: number; b: number; a: number } | null {
	const comma = css.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/);
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

function setMinWidthIfNeeded(wrapper: HTMLElement, minW: number): void {
	if (wrapper.clientWidth >= minW) return;
	const next = `${minW}px`;
	if (wrapper.style.minWidth !== next) wrapper.style.minWidth = next;
}

function setMinHeightIfNeeded(wrapper: HTMLElement, minH: number): void {
	if (wrapper.clientHeight >= minH) return;
	const next = `${minH}px`;
	if (wrapper.style.minHeight !== next) wrapper.style.minHeight = next;
}

/** Distance from top of wrapper to alphabetic baseline (CSS px). Works with inline child spans. */
export function baselineYFromTop(wrapper: HTMLElement, measureTextStr: string): number {
	const wrap = wrapper.getBoundingClientRect();
	const range = document.createRange();
	range.selectNodeContents(wrapper);
	const r = range.getBoundingClientRect();
	const ctx = document.createElement('canvas').getContext('2d')!;
	ctx.font = getComputedStyle(wrapper).font;
	const m = ctx.measureText(measureTextStr);
	const descent = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent ?? 3;
	return r.bottom - wrap.top - descent;
}

function baselineYFromSpan(wrapper: HTMLElement, span: HTMLElement, probe: CanvasRenderingContext2D): number {
	const wrap = wrapper.getBoundingClientRect();
	const range = document.createRange();
	range.selectNodeContents(span);
	const r = range.getBoundingClientRect();
	probe.font = getComputedStyle(span).font;
	const m = probe.measureText(span.textContent ?? '');
	const descent = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent ?? 3;
	return r.bottom - wrap.top - descent;
}

/**
 * Rasterize each `[data-word]` span with its own computed font and laid-out x so the mask
 * matches mixed font stacks (e.g. serif italic mid-line). A single wrapper font caused a
 * visible jump when swapping DOM text for the canvas.
 */
function drawTextMaskFromWordSpans(
	maskCanvas: HTMLCanvasElement,
	wrapper: HTMLElement,
	spans: NodeListOf<HTMLElement>,
	dpr: number
): void {
	const wrap0 = wrapper.getBoundingClientRect();
	let maxRight = wrap0.left;
	for (const span of spans) {
		maxRight = Math.max(maxRight, span.getBoundingClientRect().right);
	}
	const padX = 4;
	const minW = Math.ceil(maxRight - wrap0.left + padX + 4);
	setMinWidthIfNeeded(wrapper, minW);
	void wrapper.offsetWidth;

	const wrapAfterW = wrapper.getBoundingClientRect();
	let maxBottomRel = 0;
	for (const span of spans) {
		const br = span.getBoundingClientRect();
		maxBottomRel = Math.max(maxBottomRel, br.bottom - wrapAfterW.top);
	}
	const padBelow = 10;
	const minH = Math.ceil(maxBottomRel + padBelow);
	setMinHeightIfNeeded(wrapper, minH);
	void wrapper.offsetWidth;

	const ctx = maskCanvas.getContext('2d', { alpha: true })!;
	const wrap = wrapper.getBoundingClientRect();

	const wCss = Math.max(1, wrapper.clientWidth);
	const hCss = Math.max(1, wrapper.clientHeight);
	const w = Math.max(1, Math.ceil(wCss * dpr));
	const h = Math.max(1, Math.ceil(hCss * dpr));
	maskCanvas.width = w;
	maskCanvas.height = h;
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.clearRect(0, 0, w, h);
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.fillStyle = '#ffffff';
	ctx.textBaseline = 'alphabetic';
	ctx.textAlign = 'left';

	// Draw each character individually at its exact DOM position
	// so canvas kerning/spacing matches the browser's text shaping.
	const range = document.createRange();
	const probe = document.createElement('canvas').getContext('2d')!;

	for (const span of spans) {
		const textNode = span.firstChild;
		if (!textNode || textNode.nodeType !== Node.TEXT_NODE) continue;
		const text = textNode.textContent ?? '';
		ctx.font = getComputedStyle(span).font;
		probe.font = ctx.font;
		const ySpan = baselineYFromSpan(wrapper, span, probe);

		for (let ci = 0; ci < text.length; ci++) {
			const ch = text[ci]!;
			if (ch === ' ') continue; // skip spaces — they have no visible glyph
			range.setStart(textNode, ci);
			range.setEnd(textNode, ci + 1);
			const charRect = range.getBoundingClientRect();
			const x = charRect.left - wrap.left;
			ctx.fillText(ch, x, ySpan);
		}
	}
}

export function drawTextMask(
	maskCanvas: HTMLCanvasElement,
	text: string,
	wrapper: HTMLElement,
	dpr: number
): void {
	const wordSpans = wrapper.querySelectorAll<HTMLElement>('[data-word]');
	if (wordSpans.length > 0) {
		drawTextMaskFromWordSpans(maskCanvas, wrapper, wordSpans, dpr);
		return;
	}

	const ctx = maskCanvas.getContext('2d', { alpha: true })!;
	const font = getComputedStyle(wrapper).font;
	ctx.font = font;

	const m = ctx.measureText(text);
	const y = baselineYFromTop(wrapper, text);
	const inkW =
		Math.abs(m.actualBoundingBoxLeft ?? 0) + Math.abs(m.actualBoundingBoxRight ?? m.width);
	const padX = 4;
	const minW = Math.ceil(Math.max(m.width, inkW) + padX + 4);
	setMinWidthIfNeeded(wrapper, minW);

	// Descenders (italic y, etc.) often extend past the line box — reserve space below baseline
	const descBelow = Math.max(
		m.fontBoundingBoxDescent ?? 0,
		m.actualBoundingBoxDescent ?? 0,
		10
	);
	const padBelow = 10;
	const minH = Math.ceil(y + descBelow + padBelow);
	setMinHeightIfNeeded(wrapper, minH);

	void wrapper.offsetWidth;

	const wCss = Math.max(1, wrapper.clientWidth);
	const hCss = Math.max(1, wrapper.clientHeight);
	const w = Math.max(1, Math.ceil(wCss * dpr));
	const h = Math.max(1, Math.ceil(hCss * dpr));
	maskCanvas.width = w;
	maskCanvas.height = h;
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.clearRect(0, 0, w, h);
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.font = font;
	ctx.fillStyle = '#ffffff';
	ctx.textBaseline = 'alphabetic';
	ctx.textAlign = 'left';
	ctx.fillText(text, padX, y);
}
