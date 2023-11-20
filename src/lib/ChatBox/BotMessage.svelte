<script lang="ts">
	import huntbotlogo from '$lib/assets/huntbotlogo.webp';

	export let value: string;
</script>

<div
	class="flex w-[calc(full-4rem)] shrink-0 basis-16 flex-row flex-nowrap items-start gap-3 rounded-3xl p-2"
>
	<img
		src={huntbotlogo}
		alt="HuntBot&apos;s Avatar"
		class="h-11 w-11 flex-none rounded-2xl outline outline-1 outline-slate-200"
	/>
	<p class="mr-6 mt-2 grow whitespace-pre-line">{@html value}</p>
</div>
