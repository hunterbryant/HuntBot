<script lang="ts">
	import Huntbotlogo from '$lib/assets/huntbotlogo.svelte';
	import { slide } from 'svelte/transition';
	import { onDestroy } from 'svelte';

	const phrases = ['Hold on…', 'Iterating…', 'One sec…'];
	let index = 0;

	const FADE_OUT_MS = 120;

	function typeReveal(node: HTMLElement, text: string) {
		let timeouts: ReturnType<typeof setTimeout>[] = [];
		let current = '';

		function revealChars(t: string) {
			node.textContent = '';
			const wrapper = document.createElement('span');
			wrapper.style.cssText = 'display:inline-flex;white-space:nowrap';
			node.appendChild(wrapper);

			const chars = t.split('');
			const spans: HTMLSpanElement[] = [];

			for (const char of chars) {
				const span = document.createElement('span');
				span.textContent = char;
				span.style.cssText =
					'display:inline-block;white-space:pre;opacity:0;transform:translateY(4px);transition:opacity 140ms ease-out,transform 140ms ease-out';
				wrapper.appendChild(span);
				spans.push(span);
			}

			requestAnimationFrame(() => {
				spans.forEach((span, i) => {
					timeouts.push(
						setTimeout(() => {
							span.style.opacity = '1';
							span.style.transform = 'translateY(0)';
						}, i * 20)
					);
				});
			});
		}

		function render(t: string, fadeOut: boolean) {
			timeouts.forEach(clearTimeout);
			timeouts = [];
			current = t;

			if (fadeOut && node.children.length > 0) {
				node.style.transition = `opacity ${FADE_OUT_MS}ms ease-out`;
				node.style.opacity = '0';
				timeouts.push(
					setTimeout(() => {
						node.style.transition = '';
						node.style.opacity = '1';
						revealChars(t);
					}, FADE_OUT_MS)
				);
			} else {
				revealChars(t);
			}
		}

		timeouts.push(setTimeout(() => render(text, false), 200));

		return {
			update(newText: string) {
				if (newText !== current) render(newText, true);
			},
			destroy() {
				timeouts.forEach(clearTimeout);
			}
		};
	}

	const interval = setInterval(() => {
		index = (index + 1) % phrases.length;
	}, 2800);

	onDestroy(() => clearInterval(interval));
</script>

<div
	in:slide|global
	class="flex w-[calc(full-4rem)] shrink-0 basis-12 flex-row flex-nowrap items-start gap-1 rounded px-1 text-stone-800 dark:text-stone-200"
>
	<Huntbotlogo />

	<p class="mr-6 mt-3.5 grow whitespace-pre-line" aria-label="HuntBot is thinking">
		<span class="shimmer" use:typeReveal={phrases[index]}></span>
	</p>
</div>

<style>
	.shimmer {
		color: #a8a29e; /* stone-400 */
		-webkit-mask-image: linear-gradient(
			90deg,
			rgba(0, 0, 0, 0.4) 0%,
			rgba(0, 0, 0, 0.4) 20%,
			rgba(0, 0, 0, 1) 50%,
			rgba(0, 0, 0, 0.4) 80%,
			rgba(0, 0, 0, 0.4) 100%
		);
		mask-image: linear-gradient(
			90deg,
			rgba(0, 0, 0, 0.4) 0%,
			rgba(0, 0, 0, 0.4) 20%,
			rgba(0, 0, 0, 1) 50%,
			rgba(0, 0, 0, 0.4) 80%,
			rgba(0, 0, 0, 0.4) 100%
		);
		-webkit-mask-size: 300% 100%;
		mask-size: 300% 100%;
		animation: shimmer-sweep 2s ease-in-out infinite;
	}

	:global(.dark) .shimmer {
		color: #78716c; /* stone-500 */
	}

	@keyframes shimmer-sweep {
		0% {
			-webkit-mask-position: 150% 0;
			mask-position: 150% 0;
		}
		100% {
			-webkit-mask-position: -50% 0;
			mask-position: -50% 0;
		}
	}
</style>
