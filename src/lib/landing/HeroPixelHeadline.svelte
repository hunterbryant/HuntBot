<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount, tick } from 'svelte';
	import {
		createActuallyDitherRenderer,
		type ActuallyDitherRenderer,
		type PixelRevealUniforms
	} from './actuallyDitherRenderer';

	type Word = { text: string; class?: string };

	/** Split a sentence into per-word parts with trailing spaces */
	function toWords(sentence: string): Word[] {
		const words = sentence.split(' ');
		return words.map((w, i) => ({ text: i < words.length - 1 ? w + ' ' : w }));
	}

	const PHRASES: Word[][] = [
		toWords("Let's build the product your users actually want"),
		toWords("Let's find the problem worth solving"),
		toWords("Let's design what the data is telling us"),
		toWords("Let's build what your research reveals"),
		toWords("Let's ship the product that feels inevitable"),
		toWords("Let's craft the experience your users deserve"),
		toWords("Let's make the interface disappear"),
		toWords("Let's take your product from vision to market"),
		toWords("Let's design the product that earns its place"),
		toWords("Let's build something your users don't outgrow"),
		toWords("Let's design for the world your users move through"),
		toWords("Let's build products that meet people where they are")
	];

	const STAGGER_SEC = 0.12;
	const WORD_DURATION = 0.8;
	const MAX_WORDS = 12;
	const CYCLE_INTERVAL_MS = 14000;

	/** Pseudo-random shuffle (Fisher-Yates) seeded by timestamp, first phrase always index 0 */
	function shuffledOrder(): number[] {
		const rest = Array.from({ length: PHRASES.length - 1 }, (_, i) => i + 1);
		for (let i = rest.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[rest[i], rest[j]] = [rest[j]!, rest[i]!];
		}
		return [0, ...rest];
	}

	let phraseOrder = shuffledOrder();
	let phraseIdx = 0;
	let parts: Word[] = [...PHRASES[phraseOrder[0]!]!];
	$: fullLine = parts.map((p) => p.text).join('');

	let wrapper: HTMLSpanElement;
	let canvas: HTMLCanvasElement;
	let useGpuPaint = false;
	let canvasOpaque = false;

	const boundsScratch = new Float32Array(MAX_WORDS * 4);
	const t0Scratch = new Float32Array(MAX_WORDS);
	let revealStartMs = 0;
	let revealStarted = false;
	let reduceMotion = false;

	let cycleT0Override: Map<number, number> = new Map();
	let cyclePaused = false;

	function layoutWordsGpu(): void {
		boundsScratch.fill(2);
		if (!wrapper) return;
		const nodes = wrapper.querySelectorAll<HTMLElement>('[data-word]');
		const n = Math.min(nodes.length, MAX_WORDS);
		const wrap = wrapper.getBoundingClientRect();
		const ww = Math.max(1, wrap.width);
		const wh = Math.max(1, wrap.height);
		const padX = 8 / ww;
		const padY = 24 / wh;

		for (let i = 0; i < n; i++) {
			t0Scratch[i] = cycleT0Override.has(i) ? cycleT0Override.get(i)! : i * STAGGER_SEC;
		}
		// Zero out unused slots
		for (let i = n; i < MAX_WORDS; i++) {
			t0Scratch[i] = 0;
		}

		for (let i = 0; i < n; i++) {
			const r = nodes[i]!.getBoundingClientRect();
			const o = i * 4;
			boundsScratch[o] = (r.left - wrap.left) / ww - padX;
			boundsScratch[o + 1] = (r.right - wrap.left) / ww + padX;
			boundsScratch[o + 2] = (r.top - wrap.top) / wh - padY;
			boundsScratch[o + 3] = (r.bottom - wrap.top) / wh + padY;
		}
	}

	function getReveal(): PixelRevealUniforms {
		layoutWordsGpu();
		if (reduceMotion) {
			return {
				wordCount: parts.length,
				duration: WORD_DURATION,
				elapsed: 999,
				bounds: boundsScratch,
				wordT0: t0Scratch
			};
		}
		return {
			wordCount: parts.length,
			duration: WORD_DURATION,
			elapsed: revealStarted ? (performance.now() - revealStartMs) / 1000 : 0,
			bounds: boundsScratch,
			wordT0: t0Scratch
		};
	}

	onMount(() => {
		if (!browser) return;
		reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (reduceMotion) return;

		const maskCanvas = document.createElement('canvas');
		let renderer: ActuallyDitherRenderer | null = null;
		let raf = 0;
		let resizeRaf = 0;
		let resizeRoPending = false;
		let cancelled = false;
		let cycleTimer = 0;
		const getDpr = () => Math.min(window.devicePixelRatio || 1, 2);

		const loop = (t: number) => {
			raf = requestAnimationFrame(loop);
			if (!renderer || !wrapper) return;
			renderer.refreshMask();
			renderer.render(t * 0.001);
		};

		const startLoop = () => {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(loop);
		};

		const waitForLayout = async (): Promise<boolean> => {
			const min = 16;
			for (let i = 0; i < 90; i++) {
				if (cancelled) return false;
				await tick();
				if (wrapper && canvas && wrapper.clientWidth >= min && wrapper.clientHeight >= min) {
					return true;
				}
				await new Promise<void>((r) => requestAnimationFrame(() => r()));
			}
			return !!(wrapper && canvas && wrapper.clientWidth >= 8 && wrapper.clientHeight >= 8);
		};

		const cyclePhrase = async () => {
			if (cancelled || !renderer || !revealStarted || cyclePaused) return;
			const elapsed = (performance.now() - revealStartMs) / 1000;
			const wordCount = parts.length;

			// Dissolve all words out (negative t0 = reverse animation)
			for (let i = 0; i < wordCount; i++) {
				cycleT0Override.set(i, -(elapsed + i * STAGGER_SEC));
			}

			// Wait for dissolve to finish, then swap
			const dissolveTime = (wordCount - 1) * STAGGER_SEC + WORD_DURATION;
			await new Promise<void>((r) => setTimeout(r, dissolveTime * 1000));
			if (cancelled) return;

			// Advance to next phrase
			phraseIdx = (phraseIdx + 1) % phraseOrder.length;
			if (phraseIdx === 0) {
				phraseOrder = shuffledOrder();
			}
			const nextPhrase = PHRASES[phraseOrder[phraseIdx]!]!;
			parts = [...nextPhrase];
			cycleT0Override.clear();
			await tick();

			// Reveal all new words from now
			const now = (performance.now() - revealStartMs) / 1000;
			for (let i = 0; i < parts.length; i++) {
				cycleT0Override.set(i, now + i * STAGGER_SEC);
			}
		};

		const run = async () => {
			await tick();
			if (!canvas || !wrapper || cancelled) return;
			if (!(await waitForLayout()) || cancelled) return;

			const next = await createActuallyDitherRenderer(
				canvas,
				maskCanvas,
				wrapper,
				fullLine,
				getDpr,
				getReveal
			);
			if (cancelled) {
				next?.destroy();
				return;
			}
			if (!next) return;
			renderer = next;
			await document.fonts.ready;
			if (cancelled) return;
			await tick();
			if (cancelled) return;
			layoutWordsGpu();
			renderer.resize();
			layoutWordsGpu();
			renderer.refreshMask();
			if (cancelled) return;
			if (!reduceMotion) {
				revealStartMs = performance.now();
				revealStarted = true;
			}
			renderer.render(performance.now() * 0.001);
			if (cancelled) return;
			requestAnimationFrame(() => {
				if (cancelled) return;
				requestAnimationFrame(() => {
					if (cancelled) return;
					useGpuPaint = true;
					canvasOpaque = true;
					startLoop();

					// Start cycling after initial reveal finishes
					const initialDuration = (parts.length - 1) * STAGGER_SEC + WORD_DURATION;
					setTimeout(() => {
						if (cancelled) return;
						cycleTimer = window.setInterval(() => {
							void cyclePhrase();
						}, CYCLE_INTERVAL_MS);
					}, initialDuration * 1000 + 500);
				});
			});
		};

		void run();

		const ro = new ResizeObserver(() => {
			if (resizeRoPending) return;
			resizeRoPending = true;
			cancelAnimationFrame(resizeRaf);
			resizeRaf = requestAnimationFrame(() => {
				resizeRaf = 0;
				resizeRoPending = false;
				if (!renderer || cancelled) return;
				ro.disconnect();
				try {
					renderer.resize();
					renderer.refreshMask();
				} finally {
					ro.observe(wrapper);
				}
			});
		});
		ro.observe(wrapper);

		const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
		const onReduce = () => {
			if (!mq.matches) return;
			reduceMotion = true;
			clearInterval(cycleTimer);
			cancelAnimationFrame(resizeRaf);
			resizeRaf = 0;
			resizeRoPending = false;
			cancelAnimationFrame(raf);
			renderer?.destroy();
			renderer = null;
			useGpuPaint = false;
			canvasOpaque = false;
		};
		mq.addEventListener('change', onReduce);

		return () => {
			cancelled = true;
			clearInterval(cycleTimer);
			cancelAnimationFrame(raf);
			cancelAnimationFrame(resizeRaf);
			resizeRaf = 0;
			resizeRoPending = false;
			ro.disconnect();
			mq.removeEventListener('change', onReduce);
			renderer?.destroy();
			renderer = null;
			useGpuPaint = false;
			canvasOpaque = false;
		};
	});
</script>

<span
	bind:this={wrapper}
	class="relative inline-block w-full min-w-0 max-w-full overflow-visible align-baseline pr-[0.12em] pb-[0.18em] text-balance"
	class:text-transparent={useGpuPaint}
	role="marquee"
	aria-live="polite"
	on:mouseenter={() => (cyclePaused = true)}
	on:mouseleave={() => (cyclePaused = false)}
	on:focusin={() => (cyclePaused = true)}
	on:focusout={() => (cyclePaused = false)}
>
	{#each parts as p}
		<span data-word class="inline {p.class ?? ''}">{p.text}</span>
	{/each}
	<canvas
		bind:this={canvas}
		class="pointer-events-none absolute left-0 top-0 z-[1] h-full w-full [@media(prefers-reduced-motion:reduce)]:hidden"
		class:opacity-0={!canvasOpaque}
		aria-hidden="true"
	></canvas>
</span>
