/** Halftone dot reveal — letter-by-letter slide with full-phrase cycling */
export const WGSL_FULL = /* wgsl */ `
struct U {
	color: vec4f,
	res_time: vec4f,
	reveal: vec4f,
	b0: vec4f, b1: vec4f, b2: vec4f, b3: vec4f,
	b4: vec4f, b5: vec4f, b6: vec4f, b7: vec4f,
	b8: vec4f, b9: vec4f, b10: vec4f, b11: vec4f,
	t01: vec4f, t23: vec4f, t45: vec4f,
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var tex_m: texture_2d<f32>;
@group(0) @binding(2) var samp_m: sampler;

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
	var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
	return vec4f(p[vi], 0.0, 1.0);
}

fn bounds_at(i: u32) -> vec4f {
	switch i {
		case 0u: { return u.b0; }  case 1u: { return u.b1; }
		case 2u: { return u.b2; }  case 3u: { return u.b3; }
		case 4u: { return u.b4; }  case 5u: { return u.b5; }
		case 6u: { return u.b6; }  case 7u: { return u.b7; }
		case 8u: { return u.b8; }  case 9u: { return u.b9; }
		case 10u: { return u.b10; } case 11u: { return u.b11; }
		default: { return vec4f(0.0); }
	}
}

fn t0_at(i: u32) -> f32 {
	switch i {
		case 0u: { return u.t01.x; }  case 1u: { return u.t01.y; }
		case 2u: { return u.t01.z; }  case 3u: { return u.t01.w; }
		case 4u: { return u.t23.x; }  case 5u: { return u.t23.y; }
		case 6u: { return u.t23.z; }  case 7u: { return u.t23.w; }
		case 8u: { return u.t45.x; }  case 9u: { return u.t45.y; }
		case 10u: { return u.t45.z; } case 11u: { return u.t45.w; }
		default: { return 0.0; }
	}
}

fn letter_sharp(uv: vec2f, wn: u32, elapsed: f32, dur: f32) -> f32 {
	var bestDist = 999.0;
	var bestRawT0 = 0.0;
	var bestXProg = 0.0;
	let letterDelay = 0.06;
	for (var i: u32 = 0u; i < wn; i = i + 1u) {
		let b = bounds_at(i);
		if (b.y <= b.x || b.w <= b.z) { continue; }
		let center = vec2f((b.x + b.y) * 0.5, (b.z + b.w) * 0.5);
		let d = length(uv - center);
		if (d < bestDist) {
			bestDist = d;
			bestRawT0 = t0_at(i);
			bestXProg = clamp((uv.x - b.x) / max(b.y - b.x, 0.001), 0.0, 1.0);
		}
	}
	if (bestRawT0 < 0.0) {
		let dissolveStart = -bestRawT0 + bestXProg * letterDelay;
		return -(1.0 - clamp((elapsed - dissolveStart) / max(dur, 0.001), 0.0, 1.0));
	}
	let t0 = bestRawT0 + bestXProg * letterDelay;
	return clamp((elapsed - t0) / max(dur, 0.001), 0.0, 1.0);
}

fn quinticEaseInOut(t: f32) -> f32 {
	if (t < 0.5) {
		return 16.0 * t * t * t * t * t;
	}
	let p = 2.0 * t - 2.0;
	return 0.5 * p * p * p * p * p + 1.0;
}

@fragment
fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
	let res = u.res_time.xy;
	let uv = pos.xy / res;

	let wn = u32(u.reveal.x + 0.5);
	let dur = u.reveal.z;
	let elapsed = u.reveal.w;
	let rawSharp = letter_sharp(uv, wn, elapsed, dur);
	let dissolving = rawSharp < 0.0;
	let sharpT = abs(rawSharp);

	if (sharpT < 0.001) { discard; }

	let easeT = quinticEaseInOut(sharpT);

	let slidePixels = 14.0;
	let slideAmount = slidePixels * (1.0 - easeT) / res.y;
	var maskUV: vec2f;
	if (dissolving) {
		maskUV = vec2f(uv.x, uv.y + slideAmount);
	} else {
		maskUV = vec2f(uv.x, uv.y - slideAmount);
	}
	let aPeek = textureSample(tex_m, samp_m, maskUV).a;
	if (aPeek < 0.006) { discard; }

	if (sharpT >= 0.99) {
		return vec4f(u.color.rgb * aPeek, aPeek);
	}

	let cellSize = 6.0;
	var gridUV = pos.xy / cellSize;
	let rowIdx = floor(gridUV.y);
	gridUV.x = gridUV.x + step(1.0, fract(rowIdx * 0.5) * 2.0) * 0.5;
	let dist = length(fract(gridUV) - vec2f(0.5));

	let coverage = aPeek * easeT;
	let radius = 0.45 * sqrt(max(coverage, 0.0));
	let aa = max(1.0 / cellSize, 0.005);
	let dot = 1.0 - smoothstep(radius - aa, radius + aa, dist);

	let solidBlend = smoothstep(0.65, 0.99, sharpT);
	let finalAlpha = mix(dot * aPeek, aPeek, solidBlend);

	if (finalAlpha < 0.004) { discard; }
	return vec4f(u.color.rgb * finalAlpha, finalAlpha);
}
`;

export const GLSL_VERTEX = /* glsl */ `#version 300 es
precision highp float;
const vec2 p[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() {
	gl_Position = vec4(p[gl_VertexID], 0.0, 1.0);
}
`;

export const GLSL_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
uniform vec3 uColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uStrength;
uniform vec4 uReveal;
uniform vec4 uB0, uB1, uB2, uB3, uB4, uB5, uB6, uB7, uB8, uB9, uB10, uB11;
uniform vec4 uT0, uT1, uT2;
uniform sampler2D uMask;
out vec4 fragColor;

vec4 boundsAt(uint i) {
	if (i == 0u) return uB0;  if (i == 1u) return uB1;
	if (i == 2u) return uB2;  if (i == 3u) return uB3;
	if (i == 4u) return uB4;  if (i == 5u) return uB5;
	if (i == 6u) return uB6;  if (i == 7u) return uB7;
	if (i == 8u) return uB8;  if (i == 9u) return uB9;
	if (i == 10u) return uB10;
	return uB11;
}

float t0At(uint i) {
	if (i == 0u) return uT0.x;  if (i == 1u) return uT0.y;
	if (i == 2u) return uT0.z;  if (i == 3u) return uT0.w;
	if (i == 4u) return uT1.x;  if (i == 5u) return uT1.y;
	if (i == 6u) return uT1.z;  if (i == 7u) return uT1.w;
	if (i == 8u) return uT2.x;  if (i == 9u) return uT2.y;
	if (i == 10u) return uT2.z;
	return uT2.w;
}

float letterSharp(vec2 uv, uint wn, float elapsed, float dur) {
	float bestDist = 999.0;
	float bestRawT0 = 0.0;
	float bestXProg = 0.0;
	float letterDelay = 0.06;
	for (uint i = 0u; i < wn; i++) {
		vec4 b = boundsAt(i);
		if (b.y <= b.x || b.w <= b.z) continue;
		vec2 center = vec2((b.x + b.y) * 0.5, (b.z + b.w) * 0.5);
		float d = length(uv - center);
		if (d < bestDist) {
			bestDist = d;
			bestRawT0 = t0At(i);
			bestXProg = clamp((uv.x - b.x) / max(b.y - b.x, 0.001), 0.0, 1.0);
		}
	}
	if (bestRawT0 < 0.0) {
		float dissolveStart = -bestRawT0 + bestXProg * letterDelay;
		return -(1.0 - clamp((elapsed - dissolveStart) / max(dur, 0.001), 0.0, 1.0));
	}
	float t0 = bestRawT0 + bestXProg * letterDelay;
	return clamp((elapsed - t0) / max(dur, 0.001), 0.0, 1.0);
}

float quinticEaseInOut(float t) {
	if (t < 0.5) {
		return 16.0 * t * t * t * t * t;
	}
	float p = 2.0 * t - 2.0;
	return 0.5 * p * p * p * p * p + 1.0;
}

void main() {
	vec2 pos = gl_FragCoord.xy;
	vec2 uv = vec2(pos.x / uResolution.x, 1.0 - pos.y / uResolution.y);

	uint wn = uint(uReveal.x + 0.5);
	float dur = uReveal.z;
	float elapsed = uReveal.w;
	float rawSharp = letterSharp(uv, wn, elapsed, dur);
	bool dissolving = rawSharp < 0.0;
	float sharpT = abs(rawSharp);

	if (sharpT < 0.001) discard;

	float easeT = quinticEaseInOut(sharpT);

	float slidePixels = 14.0;
	float slideAmount = slidePixels * (1.0 - easeT) / uResolution.y;
	vec2 maskUV;
	if (dissolving) {
		maskUV = vec2(uv.x, uv.y + slideAmount);
	} else {
		maskUV = vec2(uv.x, uv.y - slideAmount);
	}
	float aPeek = texture(uMask, maskUV).a;
	if (aPeek < 0.006) discard;

	if (sharpT >= 0.99) {
		fragColor = vec4(uColor * aPeek, aPeek);
		return;
	}

	float cellSize = 6.0;
	vec2 gridUV = pos / cellSize;
	float rowIdx = floor(gridUV.y);
	gridUV.x += step(1.0, fract(rowIdx * 0.5) * 2.0) * 0.5;
	float dist = length(fract(gridUV) - 0.5);

	float coverage = aPeek * easeT;
	float radius = 0.45 * sqrt(max(coverage, 0.0));
	float aa = fwidth(dist);
	float dot = 1.0 - smoothstep(radius - aa, radius + aa, dist);

	float solidBlend = smoothstep(0.65, 0.99, sharpT);
	float finalAlpha = mix(dot * aPeek, aPeek, solidBlend);

	if (finalAlpha < 0.004) discard;
	fragColor = vec4(uColor * finalAlpha, finalAlpha);
}
`;
