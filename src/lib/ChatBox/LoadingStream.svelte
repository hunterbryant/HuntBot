<script lang="ts">
	import Huntbotlogo from '$lib/assets/huntbotlogo.svelte';
	import { slide } from 'svelte/transition';
</script>

<div
	in:slide|global
	class="flex w-[calc(full-4rem)] shrink-0 basis-12 flex-row flex-nowrap items-start gap-1 rounded px-1 text-stone-800 dark:text-stone-200"
>
	<Huntbotlogo />

	<p class="mr-6 mt-3.5 grow whitespace-pre-line">
		<span class="dots" aria-label="HuntBot is thinking">
			<span class="dot" />
			<span class="dot" />
			<span class="dot" />
		</span>
	</p>
</div>

<style>
	.dots {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.dot {
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: currentColor;
		opacity: 0.5;
		animation: huntbot-bounce 1.2s ease-in-out infinite;
	}
	.dot:nth-child(2) {
		animation-delay: 0.2s;
	}
	.dot:nth-child(3) {
		animation-delay: 0.4s;
	}
	@keyframes huntbot-bounce {
		0%,
		60%,
		100% {
			transform: translateY(0);
			opacity: 0.5;
		}
		30% {
			transform: translateY(-5px);
			opacity: 1;
		}
	}
</style>
