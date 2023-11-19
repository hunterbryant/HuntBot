<script>
	import huntbotlogo from './assets/huntbotlogo.webp';
	import arrowup from './assets/arrow-up.svg';
</script>

<div
	class="flex h-16 w-[calc(full-4rem)] flex-row flex-nowrap items-center gap-3 rounded-b-3xl bg-slate-50 p-2 outline-1 -outline-offset-1 focus-within:outline focus-within:outline-slate-300"
>
	<img
		src={huntbotlogo}
		alt="HuntBot&apos;s Avatar"
		class="h-11 w-11 flex-none rounded-2xl outline outline-1 outline-slate-200"
	/>
	<p class="hidden grow">Hello 👋, I’m HuntBot</p>
	<input
		placeholder="If you need me... ask away!"
		class="min-w-0 grow bg-transparent focus:outline-none"
	/>
	<button class="h-11 w-11 rounded-2xl bg-blue-500 transition hover:bg-blue-600 hover:shadow-md">
		<img src={arrowup} alt="Up arrow icon" class="m-auto flex-none" />
	</button>
</div>
