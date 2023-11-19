<script>
	import huntbotlogo from './assets/huntbotlogo.webp';
	import arrowup from './assets/arrow-up.svg';
</script>

<div class="flex h-16 w-[calc(full-4rem)] flex-row flex-nowrap items-center gap-3 bg-slate-100 p-2">
	<img
		src={huntbotlogo}
		alt="HuntBot&apos;s Avatar"
		class="h-11 w-11 flex-none rounded-2xl outline outline-1 outline-slate-200"
	/>
	<p class="grow">Hello 👋, I’m HuntBot</p>
	<input placeholder="If you need me... ask away!" class="hidden min-w-0 grow bg-transparent" />
	<button class="h-11 w-11 rounded-2xl bg-blue-500 transition hover:bg-blue-600 hover:shadow-md">
		<img src={arrowup} alt="Up arrow icon" class="m-auto flex-none" />
	</button>
</div>
