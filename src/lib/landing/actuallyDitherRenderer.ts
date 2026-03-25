/// <reference types="@webgpu/types" />

/** Uniform: color, res/time, reveal, 12× word bounds (vec4), 12 word t0 floats — 320 bytes */
export const UNIFORM_BYTE_LENGTH = 320;

export interface PixelRevealUniforms {
	wordCount: number;
	duration: number;
	elapsed: number;
	/** Per word: minX, maxX, minY, maxY in 0–1 (mask UV, top-left origin) */
	bounds: Float32Array;
	/** Per-word reveal start time in seconds (DOM order) */
	wordT0: Float32Array;
}

/**
 * Pack GPU uniform buffer for halftone / reveal shaders (WebGPU WGSL or WebGL).
 * Keep in sync with shader struct layout.
 */
export function writePixelUniforms(
	out: Float32Array,
	rgb: [number, number, number],
	resW: number,
	resH: number,
	time: number,
	strength: number,
	reveal: PixelRevealUniforms
): void {
	out.fill(0);
	out[0] = rgb[0];
	out[1] = rgb[1];
	out[2] = rgb[2];
	out[3] = 1;
	out[4] = resW;
	out[5] = resH;
	out[6] = time;
	out[7] = strength;
	out[8] = reveal.wordCount;
	out[9] = 0;
	out[10] = reveal.duration;
	out[11] = reveal.elapsed;
	const b = reveal.bounds;
	for (let i = 0; i < 12; i++) {
		const j = 12 + i * 4;
		const o = i * 4;
		out[j] = b?.[o] ?? 0;
		out[j + 1] = b?.[o + 1] ?? 0;
		out[j + 2] = b?.[o + 2] ?? 0;
		out[j + 3] = b?.[o + 3] ?? 0;
	}
	const t = reveal.wordT0;
	for (let i = 0; i < 12; i++) {
		out[60 + i] = t?.[i] ?? 0;
	}
}
