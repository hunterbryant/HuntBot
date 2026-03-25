import { describe, expect, it } from 'vitest';
import {
	UNIFORM_BYTE_LENGTH,
	writePixelUniforms,
	type PixelRevealUniforms
} from './actuallyDitherRenderer';

describe('writePixelUniforms', () => {
	it('writes header and reveal fields', () => {
		const out = new Float32Array(UNIFORM_BYTE_LENGTH / 4);
		const bounds = new Float32Array(48);
		bounds[0] = 0.1;
		bounds[1] = 0.9;
		const wordT0 = new Float32Array(12);
		wordT0[0] = 0.25;
		const reveal: PixelRevealUniforms = {
			wordCount: 3,
			duration: 0.8,
			elapsed: 0.1,
			bounds,
			wordT0
		};
		writePixelUniforms(out, [0.2, 0.4, 0.6], 800, 600, 1.5, 0.58, reveal);
		expect(out[0]).toBeCloseTo(0.2);
		expect(out[1]).toBeCloseTo(0.4);
		expect(out[2]).toBeCloseTo(0.6);
		expect(out[4]).toBe(800);
		expect(out[5]).toBe(600);
		expect(out[6]).toBeCloseTo(1.5);
		expect(out[7]).toBeCloseTo(0.58);
		expect(out[8]).toBe(3);
		expect(out[10]).toBeCloseTo(0.8);
		expect(out[11]).toBeCloseTo(0.1);
		expect(out[12]).toBeCloseTo(0.1);
		expect(out[13]).toBeCloseTo(0.9);
		expect(out[60]).toBeCloseTo(0.25);
	});

	it('zero-fills missing bounds/t0 slots', () => {
		const out = new Float32Array(UNIFORM_BYTE_LENGTH / 4);
		const reveal: PixelRevealUniforms = {
			wordCount: 0,
			duration: 1,
			elapsed: 0,
			bounds: new Float32Array(0),
			wordT0: new Float32Array(0)
		};
		writePixelUniforms(out, [0, 0, 0], 1, 1, 0, 0, reveal);
		expect(out[12]).toBe(0);
		expect(out[60]).toBe(0);
	});
});
