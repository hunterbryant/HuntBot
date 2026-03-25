import { describe, expect, it } from 'vitest';
import { parseRgba01 } from './actuallyDitherMask';

describe('parseRgba01', () => {
	it('parses rgb() comma syntax', () => {
		expect(parseRgba01('rgb(255, 128, 0)')).toEqual({ r: 1, g: 128 / 255, b: 0, a: 1 });
	});

	it('parses rgba() comma syntax with alpha', () => {
		expect(parseRgba01('rgba(10, 20, 30, 0.5)')).toEqual({
			r: 10 / 255,
			g: 20 / 255,
			b: 30 / 255,
			a: 0.5
		});
	});

	it('parses modern space syntax', () => {
		const p = parseRgba01('rgb(100 150 200 / 80%)');
		expect(p?.r).toBeCloseTo(100 / 255);
		expect(p?.g).toBeCloseTo(150 / 255);
		expect(p?.b).toBeCloseTo(200 / 255);
		expect(p?.a).toBeCloseTo(0.8);
	});

	it('returns null for invalid input', () => {
		expect(parseRgba01('not a color')).toBeNull();
	});
});
