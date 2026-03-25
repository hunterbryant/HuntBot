/// <reference types="@webgpu/types" />

import { GLSL_FRAGMENT, GLSL_VERTEX, WGSL_FULL } from './actuallyDitherShaders';
import { drawTextMask, resolveForegroundRgb01 } from './actuallyDitherMask';

const DITHER_STRENGTH = 0.58;
/** Uniform: color, res/time, reveal, 12× word bounds (vec4), 3× word t0 (vec4) — 320 bytes */
const UNIFORM_BYTE_LENGTH = 320;
/** Skip resize when layout briefly reports a near-zero box (RO / flex churn) — empty mask discards all fragments. */
const MIN_LAYOUT_CSS_PX = 8;

export interface PixelRevealUniforms {
	wordCount: number;
	duration: number;
	elapsed: number;
	/** Per word: minX, maxX, minY, maxY in 0–1 (mask UV, top-left origin) */
	bounds: Float32Array;
	/** Per-word reveal start time in seconds (DOM order; line 2 after line 1 completes) */
	wordT0: Float32Array;
}

export interface ActuallyDitherRenderer {
	render: (timeSeconds: number) => void;
	resize: () => void;
	/** Re-rasterize the text mask and upload to GPU without recreating textures (safe every frame). */
	refreshMask: () => void;
	destroy: () => void;
}

function writePixelUniforms(
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
	// t0 starts at offset 60 (12 + 12*4)
	const t = reveal.wordT0;
	for (let i = 0; i < 12; i++) {
		out[60 + i] = t?.[i] ?? 0;
	}
}

export async function createWebGpuRenderer(
	canvas: HTMLCanvasElement,
	maskCanvas: HTMLCanvasElement,
	wrapper: HTMLElement,
	text: string,
	getDpr: () => number,
	getReveal: () => PixelRevealUniforms
): Promise<ActuallyDitherRenderer | null> {
	const gpu = navigator.gpu;
	if (!gpu) return null;
	let adapter: GPUAdapter | null;
	try {
		adapter = await gpu.requestAdapter({ powerPreference: 'low-power' });
	} catch {
		return null;
	}
	if (!adapter) return null;
	let device: GPUDevice;
	try {
		device = await adapter.requestDevice();
	} catch {
		return null;
	}

	const ctxMaybe = canvas.getContext('webgpu');
	if (!ctxMaybe) return null;
	const context = ctxMaybe as GPUCanvasContext;

	const format = gpu.getPreferredCanvasFormat();
	let module: GPUShaderModule;
	let pipeline: GPURenderPipeline;
	let bindGroupLayout: GPUBindGroupLayout;
	try {
		module = device.createShaderModule({ code: WGSL_FULL });

		// WebGPU createShaderModule does NOT throw on WGSL errors — it silently
		// creates an invalid module.  Check compilation info so we can fall back
		// to WebGL2 instead of rendering blank frames.
		const info = await module.getCompilationInfo();
		if (info.messages.some((m) => m.type === 'error')) {
			device.destroy();
			return null;
		}

		bindGroupLayout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
				{ binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }
			]
		});

		const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });

		pipeline = device.createRenderPipeline({
			layout: pipelineLayout,
			vertex: { module, entryPoint: 'vs_main' },
			fragment: {
				module,
				entryPoint: 'fs_main',
				targets: [
					{
						format,
						blend: {
							color: {
								srcFactor: 'one',
								dstFactor: 'one-minus-src-alpha',
								operation: 'add'
							},
							alpha: {
								srcFactor: 'one',
								dstFactor: 'one-minus-src-alpha',
								operation: 'add'
							}
						}
					}
				]
			},
			primitive: { topology: 'triangle-list' }
		});
	} catch {
		device.destroy();
		return null;
	}

	const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

	const uniformBuffer = device.createBuffer({
		size: UNIFORM_BYTE_LENGTH,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
	});
	const uniformScratch = new Float32Array(UNIFORM_BYTE_LENGTH / 4);

	let maskTexture: GPUTexture | null = null;
	let bindGroup: GPUBindGroup | null = null;
	let lastW = 0;
	let lastH = 0;
	let lastStableWCss = 0;
	let lastStableHCss = 0;

	function ensureMaskTexture(w: number, h: number) {
		if (maskTexture && lastW === w && lastH === h) return;
		maskTexture?.destroy();
		lastW = w;
		lastH = h;
		maskTexture = device.createTexture({
			size: { width: w, height: h },
			format: 'rgba8unorm',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
		});
		bindGroup = device.createBindGroup({
			layout: bindGroupLayout,
			entries: [
				{ binding: 0, resource: { buffer: uniformBuffer } },
				{ binding: 1, resource: maskTexture.createView() },
				{ binding: 2, resource: sampler }
			]
		});
	}

	function syncCanvasSize() {
		const rawW = wrapper.clientWidth;
		const rawH = wrapper.clientHeight;
		if (rawW >= MIN_LAYOUT_CSS_PX && rawH >= MIN_LAYOUT_CSS_PX) {
			lastStableWCss = rawW;
			lastStableHCss = rawH;
		} else if (lastStableWCss >= MIN_LAYOUT_CSS_PX && lastStableHCss >= MIN_LAYOUT_CSS_PX) {
			// Keep previous mask/size — do not redraw with a collapsed layout box.
			return;
		} else {
			return;
		}

		const dpr = getDpr();
		const wCss = lastStableWCss;
		const hCss = lastStableHCss;
		const bw = Math.max(1, Math.ceil(wCss * dpr));
		const bh = Math.max(1, Math.ceil(hCss * dpr));
		canvas.width = bw;
		canvas.height = bh;
		canvas.style.width = `${wCss}px`;
		canvas.style.height = `${hCss}px`;
		context.configure({
			device,
			format,
			alphaMode: 'premultiplied'
		});
		drawTextMask(maskCanvas, text, wrapper, dpr);
		ensureMaskTexture(maskCanvas.width, maskCanvas.height);
		device.queue.copyExternalImageToTexture(
			{ source: maskCanvas },
			{ texture: maskTexture! },
			{ width: maskCanvas.width, height: maskCanvas.height }
		);
	}

	function refreshMask() {
		const rawW = wrapper.clientWidth;
		const rawH = wrapper.clientHeight;
		if (rawW >= MIN_LAYOUT_CSS_PX && rawH >= MIN_LAYOUT_CSS_PX) {
			lastStableWCss = rawW;
			lastStableHCss = rawH;
		}
		if (lastStableWCss < MIN_LAYOUT_CSS_PX || lastStableHCss < MIN_LAYOUT_CSS_PX) return;

		const dpr = getDpr();
		const wCss = lastStableWCss;
		const hCss = lastStableHCss;
		const bw = Math.max(1, Math.ceil(wCss * dpr));
		const bh = Math.max(1, Math.ceil(hCss * dpr));

		if (!maskTexture || canvas.width !== bw || canvas.height !== bh) {
			syncCanvasSize();
			return;
		}

		drawTextMask(maskCanvas, text, wrapper, dpr);
		if (maskCanvas.width !== bw || maskCanvas.height !== bh || !maskTexture) {
			syncCanvasSize();
			return;
		}
		device.queue.copyExternalImageToTexture(
			{ source: maskCanvas },
			{ texture: maskTexture },
			{ width: maskCanvas.width, height: maskCanvas.height }
		);
	}

	syncCanvasSize();

	const destroy = () => {
		maskTexture?.destroy();
		uniformBuffer.destroy();
		device.destroy();
	};

	return {
		resize: () => {
			syncCanvasSize();
		},
		refreshMask,
		render: (timeSeconds: number) => {
			if (!bindGroup || !maskTexture) return;
			const rgb = resolveForegroundRgb01(wrapper);
			writePixelUniforms(
				uniformScratch,
				rgb,
				canvas.width,
				canvas.height,
				timeSeconds,
				DITHER_STRENGTH,
				getReveal()
			);
			device.queue.writeBuffer(uniformBuffer, 0, uniformScratch);

			const encoder = device.createCommandEncoder();
			const pass = encoder.beginRenderPass({
				colorAttachments: [
					{
						view: context.getCurrentTexture().createView(),
						clearValue: { r: 0, g: 0, b: 0, a: 0 },
						loadOp: 'clear',
						storeOp: 'store'
					}
				]
			});
			pass.setPipeline(pipeline);
			pass.setBindGroup(0, bindGroup);
			pass.draw(3);
			pass.end();
			device.queue.submit([encoder.finish()]);
		},
		destroy
	};
}

export function createWebGlRenderer(
	canvas: HTMLCanvasElement,
	maskCanvas: HTMLCanvasElement,
	wrapper: HTMLElement,
	text: string,
	getDpr: () => number,
	getReveal: () => PixelRevealUniforms
): ActuallyDitherRenderer | null {
	const glRaw = canvas.getContext('webgl2', {
		alpha: true,
		premultipliedAlpha: true,
		antialias: false
	}) as WebGL2RenderingContext | null;
	if (!glRaw) return null;
	const gl = glRaw;

	const vs = gl.createShader(gl.VERTEX_SHADER)!;
	gl.shaderSource(vs, GLSL_VERTEX);
	gl.compileShader(vs);
	if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
		gl.deleteShader(vs);
		return null;
	}
	const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
	gl.shaderSource(fs, GLSL_FRAGMENT);
	gl.compileShader(fs);
	if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
		gl.deleteShader(vs);
		gl.deleteShader(fs);
		return null;
	}
	const program = gl.createProgram()!;
	gl.attachShader(program, vs);
	gl.attachShader(program, fs);
	gl.linkProgram(program);
	gl.deleteShader(vs);
	gl.deleteShader(fs);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		gl.deleteProgram(program);
		return null;
	}

	const uColor = gl.getUniformLocation(program, 'uColor');
	const uResolution = gl.getUniformLocation(program, 'uResolution');
	const uTime = gl.getUniformLocation(program, 'uTime');
	const uStrength = gl.getUniformLocation(program, 'uStrength');
	const uReveal = gl.getUniformLocation(program, 'uReveal');
	const uB = Array.from({ length: 12 }, (_, i) => gl.getUniformLocation(program, `uB${i}`));
	const uT0 = gl.getUniformLocation(program, 'uT0');
	const uT1 = gl.getUniformLocation(program, 'uT1');
	const uT2 = gl.getUniformLocation(program, 'uT2');
	const uMask = gl.getUniformLocation(program, 'uMask');

	const texture = gl.createTexture()!;
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

	let lastTw = 0;
	let lastTh = 0;
	let lastStableWCss = 0;
	let lastStableHCss = 0;

	function syncCanvasSize() {
		const rawW = wrapper.clientWidth;
		const rawH = wrapper.clientHeight;
		if (rawW >= MIN_LAYOUT_CSS_PX && rawH >= MIN_LAYOUT_CSS_PX) {
			lastStableWCss = rawW;
			lastStableHCss = rawH;
		} else if (lastStableWCss >= MIN_LAYOUT_CSS_PX && lastStableHCss >= MIN_LAYOUT_CSS_PX) {
			return;
		} else {
			return;
		}

		const dpr = getDpr();
		const wCss = lastStableWCss;
		const hCss = lastStableHCss;
		const bw = Math.max(1, Math.ceil(wCss * dpr));
		const bh = Math.max(1, Math.ceil(hCss * dpr));
		canvas.width = bw;
		canvas.height = bh;
		canvas.style.width = `${wCss}px`;
		canvas.style.height = `${hCss}px`;
		gl.viewport(0, 0, bw, bh);
		drawTextMask(maskCanvas, text, wrapper, dpr);
		if (maskCanvas.width !== lastTw || maskCanvas.height !== lastTh) {
			lastTw = maskCanvas.width;
			lastTh = maskCanvas.height;
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.texImage2D(
				gl.TEXTURE_2D,
				0,
				gl.RGBA,
				gl.RGBA,
				gl.UNSIGNED_BYTE,
				maskCanvas
			);
		} else {
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, maskCanvas);
		}
	}

	function refreshMask() {
		const rawW = wrapper.clientWidth;
		const rawH = wrapper.clientHeight;
		if (rawW >= MIN_LAYOUT_CSS_PX && rawH >= MIN_LAYOUT_CSS_PX) {
			lastStableWCss = rawW;
			lastStableHCss = rawH;
		}
		if (lastStableWCss < MIN_LAYOUT_CSS_PX || lastStableHCss < MIN_LAYOUT_CSS_PX) return;

		const dpr = getDpr();
		const wCss = lastStableWCss;
		const hCss = lastStableHCss;
		const bw = Math.max(1, Math.ceil(wCss * dpr));
		const bh = Math.max(1, Math.ceil(hCss * dpr));

		if (canvas.width !== bw || canvas.height !== bh) {
			syncCanvasSize();
			return;
		}

		drawTextMask(maskCanvas, text, wrapper, dpr);
		if (maskCanvas.width !== bw || maskCanvas.height !== bh) {
			syncCanvasSize();
			return;
		}
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, maskCanvas);
	}

	syncCanvasSize();

	const scratch = new Float32Array(UNIFORM_BYTE_LENGTH / 4);

	return {
		resize: () => syncCanvasSize(),
		refreshMask,
		render: (timeSeconds: number) => {
			const rgb = resolveForegroundRgb01(wrapper);
			const rev = getReveal();
			writePixelUniforms(scratch, rgb, canvas.width, canvas.height, timeSeconds, DITHER_STRENGTH, rev);

			gl.useProgram(program);
			gl.uniform3f(uColor, rgb[0], rgb[1], rgb[2]);
			gl.uniform2f(uResolution, canvas.width, canvas.height);
			gl.uniform1f(uTime, timeSeconds);
			gl.uniform1f(uStrength, DITHER_STRENGTH);
			gl.uniform4f(uReveal, scratch[8], scratch[9], scratch[10], scratch[11]);
			for (let i = 0; i < 12; i++) {
				const j = 12 + i * 4;
				const loc = uB[i];
				if (loc) gl.uniform4f(loc, scratch[j], scratch[j + 1], scratch[j + 2], scratch[j + 3]);
			}
			gl.uniform4f(uT0, scratch[60], scratch[61], scratch[62], scratch[63]);
			gl.uniform4f(uT1, scratch[64], scratch[65], scratch[66], scratch[67]);
			gl.uniform4f(uT2, scratch[68], scratch[69], scratch[70], scratch[71]);
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.uniform1i(uMask, 0);
			gl.enable(gl.BLEND);
			gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
			gl.clearColor(0, 0, 0, 0);
			gl.clear(gl.COLOR_BUFFER_BIT);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
		},
		destroy: () => {
			gl.deleteTexture(texture);
			gl.deleteProgram(program);
		}
	};
}

export async function createActuallyDitherRenderer(
	canvas: HTMLCanvasElement,
	maskCanvas: HTMLCanvasElement,
	wrapper: HTMLElement,
	text: string,
	getDpr: () => number,
	getReveal: () => PixelRevealUniforms
): Promise<ActuallyDitherRenderer | null> {
	// TODO: re-enable WebGPU once Safari's implementation is stable
	// const wgpu = await createWebGpuRenderer(canvas, maskCanvas, wrapper, text, getDpr, getReveal);
	// if (wgpu) {
	// 	console.debug('[halftone] using WebGPU renderer');
	// 	return wgpu;
	// }
	const gl = createWebGlRenderer(canvas, maskCanvas, wrapper, text, getDpr, getReveal);
	if (gl) {
		console.debug('[halftone] using WebGL2 renderer (WebGPU unavailable)');
		return gl;
	}
	console.debug('[halftone] no GPU renderer available — DOM text fallback');
	return null;
}
