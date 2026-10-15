<script lang="ts">
	import { onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { HUNTBOT_PATHS, SKETCH_FRAMES } from './huntbot-sketch-frames';

	// still:    the plain avatar.
	// sketchy:  idle. Just a slow "line boil", like a hand-drawn sketch redrawn frame by frame.
	// thinking: working something out. The line boils a little faster, the smile flattens while
	//           the eyes drift across like they're reading, then it glances up with a wavy
	//           "hmm" mouth.
	export let mode: 'still' | 'sketchy' | 'thinking' = 'still';

	// Change this to any new value to make HuntBot blink once, e.g. when a new suggestion shows.
	export let blinkOn: unknown = undefined;

	const BOIL_MS = { sketchy: 480, thinking: 220 };
	const BLINK_MS = 260;

	// The boil swaps between pre-wobbled copies of the drawing (see
	// scripts/generate-huntbot-sketch-frames.mjs) in steps, like animation drawn on twos. It's
	// plain vector geometry, so it stays crisp; an SVG filter rendered blurry on iOS Safari.
	let frame = -1;
	let boilTimer: ReturnType<typeof setInterval> | undefined;

	function startBoil(m: typeof mode) {
		clearInterval(boilTimer);
		frame = -1;
		if (!browser || m === 'still') return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		frame = 0;
		boilTimer = setInterval(() => {
			frame = (frame + 1) % SKETCH_FRAMES.length;
		}, BOIL_MS[m]);
	}

	$: startBoil(mode);
	$: paths = frame < 0 ? HUNTBOT_PATHS : SKETCH_FRAMES[frame];

	let blinking = false;
	let blinkTimer: ReturnType<typeof setTimeout> | undefined;
	let lastBlinkOn = blinkOn;

	$: if (blinkOn !== lastBlinkOn) {
		lastBlinkOn = blinkOn;
		// Thinking already blinks on its own loop.
		if (mode !== 'thinking') {
			clearTimeout(blinkTimer);
			blinking = true;
			blinkTimer = setTimeout(() => (blinking = false), BLINK_MS);
		}
	}

	onDestroy(() => {
		clearInterval(boilTimer);
		clearTimeout(blinkTimer);
	});
</script>

<svg
	width="48"
	height="48"
	viewBox="0 0 48 48"
	class="h-12 flex-none basis-12 fill-current"
	class:thinking={mode === 'thinking'}
	class:blinking
	xmlns="http://www.w3.org/2000/svg"
>
	<g class="head">
		<path fill-rule="evenodd" clip-rule="evenodd" class="fill-current" d={paths.head} />
		<g class="eyes">
			<path class="eye fill-current" d={paths.leftEye} />
			<path class="eye fill-current" d={paths.rightEye} />
		</g>
		<path class="mouth fill-current" d={paths.mouth} />
		{#if mode === 'thinking'}
			<!-- Stand-ins for the smile, which looks smug on a face that is meant to be concentrating. -->
			<g
				class="thinking-mouths"
				fill="none"
				stroke="currentColor"
				stroke-width="1.1"
				stroke-linecap="round"
			>
				<path class="mouth-flat" d={paths.mouthFlat} />
				<path class="mouth-hmm" d={paths.mouthHmm} />
			</g>
		{/if}
	</g>
</svg>

<style>
	/* One slow beat: read across, glance up and mull it over, repeat. */
	.thinking .head,
	.thinking .eyes,
	.thinking .eye,
	.thinking .mouth-flat,
	.thinking .mouth-hmm {
		animation-duration: 7s;
		animation-iteration-count: infinite;
		animation-timing-function: ease-in-out;
	}

	/* Pivot the head from the bottom of the face so the tilt reads as a head tilt, not a spin. */
	.thinking .head {
		transform-origin: 24px 34px;
		animation-name: ponder;
	}

	.thinking .eyes {
		animation-name: scan;
	}

	.thinking .eye {
		transform-box: fill-box;
		transform-origin: center;
		animation-name: blink;
	}

	.thinking .mouth {
		display: none;
	}

	.thinking .mouth-flat {
		animation-name: mouth-flat;
	}

	.thinking .mouth-hmm {
		opacity: 0;
		animation-name: mouth-hmm;
	}

	/* Slight lean in while reading, then tip back the other way to mull it over. */
	@keyframes ponder {
		0%,
		100% {
			transform: rotate(0deg);
		}
		8%,
		58% {
			transform: rotate(-3deg);
		}
		68%,
		90% {
			transform: rotate(5deg);
		}
	}

	/* Drift slowly across a line like it's reading, then look up and away. */
	@keyframes scan {
		0%,
		100% {
			transform: translate(0, 0);
		}
		10%,
		22% {
			transform: translate(-1px, 0);
		}
		32%,
		40% {
			transform: translate(0, 0);
		}
		50%,
		58% {
			transform: translate(1px, 0);
		}
		68%,
		88% {
			transform: translate(1.3px, -0.9px);
		}
	}

	/* A blink as it looks up from "reading". */
	@keyframes blink {
		0%,
		60%,
		66%,
		100% {
			transform: scaleY(1);
		}
		63% {
			transform: scaleY(0.1);
		}
	}

	/* Flat, focused mouth while reading; crossfades to the wavy "hmm" while mulling. */
	@keyframes mouth-flat {
		0%,
		60%,
		94%,
		100% {
			opacity: 1;
		}
		66%,
		88% {
			opacity: 0;
		}
	}

	@keyframes mouth-hmm {
		0%,
		60%,
		94%,
		100% {
			opacity: 0;
			transform: translateX(0);
		}
		66%,
		88% {
			opacity: 1;
			transform: translateX(0.6px);
		}
	}

	/* One-off blink, e.g. when a new suggestion shows up. */
	.blinking .eye {
		transform-box: fill-box;
		transform-origin: center;
		animation: blink-once 260ms ease-in-out;
	}

	@keyframes blink-once {
		0%,
		100% {
			transform: scaleY(1);
		}
		50% {
			transform: scaleY(0.1);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.blinking .eye,
		.thinking .head,
		.thinking .eyes,
		.thinking .eye,
		.thinking .mouth-flat,
		.thinking .mouth-hmm {
			animation: none;
		}
	}
</style>
