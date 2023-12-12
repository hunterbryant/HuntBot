<script lang="ts">
	import StudioImage from '$lib/assets/studiobg2.webp';
</script>

<svelte:head>
	<title>Hunter Bryant – Product Designer</title>
	<meta
		name="description"
		content="Hunter Bryant is a product designer with a proven track record of bringing products from ideation to market. With a deep understanding of the challenges faced by teams at all scales of business, I am able to adapt to various design, research, and engineering constraints."
	/>
</svelte:head>

<div
	class="inset-x-0 mx-auto grid h-full w-full max-w-screen-2xl grid-cols-5 grid-rows-6 gap-4 px-2 py-16 sm:grid-cols-9 sm:px-16"
>
	<!-- This div covers the first vertical half of the nav bar -->
	<div class="col-span-5 row-span-3 flex">
		<h1 class="my-auto text-6xl font-bold tracking-tighter">
			I’m a designer that will build you a product your users <span class="font-serif">really</span>
			want.
		</h1>
	</div>
	<div class="col-start-4 col-end-10 row-span-2 overflow-hidden rounded bg-stone-200">
		<img
			src={StudioImage}
			alt="A portrait of Hunter in a studio"
			class="m-auto block h-full w-full object-cover"
		/>
	</div>
</div>
