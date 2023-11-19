<script>
	import huntbotlogo from './assets/huntbotlogo.webp';
</script>

<div
	class="flex w-[calc(full-4rem)] shrink-0 basis-16 flex-row flex-nowrap items-center gap-3 rounded-3xl p-2"
>
	<img
		src={huntbotlogo}
		alt="HuntBot&apos;s Avatar"
		class="h-11 w-11 flex-none rounded-2xl outline outline-1 outline-slate-200"
	/>
	<p class="grow">Hello 👋, I’m HuntBot</p>
	<button
		class="h-11 rounded-2xl bg-blue-600 px-3 text-white transition hover:bg-blue-700 hover:shadow-md active:bg-blue-600 active:shadow-none"
	>
		Not another GPT
	</button>
	<hr class="absolute left-4 right-4 top-16 bg-slate-200 peer-focus:hidden" />
</div>
