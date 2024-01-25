<script lang="ts">
	import { page } from '$app/stores';
	import HuntBotLost from '$lib/assets/huntbot-lost.svelte';

	let message: string;

	//  Support other error messages here
	switch ($page.status) {
		case 404:
			message =
				$page.error?.message === 'Not Found'
					? 'I looked everywhere but couldn’t find the right page. I’ll let Hunter know.'
					: $page.error?.message ??
						'I looked everywhere but couldn’t find the right page. I’ll let Hunter know.';
			break;
		case 500:
			message = 'My bad, my code got scrambled. I’ll let Hunter know.';
			break;
		default:
			message = $page.error?.message ?? 'My bad, my code got scrambled. I’ll let Hunter know.';
	}
</script>

<!-- Handle horizontal bounds -->
<div
	class="inset-x-0 z-30 mx-auto flex w-full max-w-screen-xl flex-col gap-4 px-2 pb-16 pt-24 sm:px-8 sm:pb-24 sm:pt-0 lg:px-16"
>
	<!-- Grid -->
	<div
		class="grid grow auto-rows-min grid-cols-5 gap-x-4 sm:grid-cols-6 md:grid-cols-7 lg:grid-cols-9"
	>
		<div
			class="col-start-1 col-end-6 mb-10 mt-12 flex flex-col justify-end rounded text-7xl font-bold tracking-tighter text-stone-800 sm:col-start-4 sm:col-end-7 sm:mb-16 sm:mt-0 sm:h-[24.5rem] md:col-end-8 md:text-8xl lg:col-end-10 lg:text-9xl"
		>
			<h2
				class="mb-0 flex items-center gap-4 sm:-mb-3 md:-mb-4 lg:-mb-7 [&_svg]:mb-1 [&_svg]:size-16 md:[&_svg]:mb-4 md:[&_svg]:size-20 lg:[&_svg]:mb-6 lg:[&_svg]:size-28"
			>
				{$page.status}
				<HuntBotLost />
			</h2>
		</div>
		<div
			class="col-start-1 col-end-6 flex flex-col gap-4 text-balance text-2xl font-medium leading-none tracking-tight text-stone-500 sm:col-start-4 sm:col-end-7 md:col-end-8 md:text-3xl lg:col-end-9"
		>
			{message}
		</div>
	</div>
</div>
