<script>
	import huntbotlogo from './assets/huntbotlogo.webp';
	import arrowup from './assets/arrow-up.svg';

	let message = '';

	function handleSubmit() {
		console.log('User sent:', message);

		// Clear the message after sending
		message = '';
	}
</script>

<form
	on:submit|preventDefault={handleSubmit}
	class="flex w-[calc(full-4rem)] shrink-0 basis-16 flex-row-reverse flex-nowrap items-center gap-3 overflow-visible rounded-3xl p-2 outline-2 -outline-offset-2 focus-within:outline focus-within:outline-blue-200"
>
	<button
		type="submit"
		class="peer h-11 w-11 rounded-2xl bg-blue-600 transition hover:bg-blue-700 hover:shadow-md active:bg-blue-600 active:shadow-none disabled:bg-blue-200"
		disabled={message.trim() === ''}
	>
		<img src={arrowup} alt="Up arrow icon" class="m-auto flex-none" />
	</button>
	<input
		placeholder="Message HuntBot"
		class="peer ml-2 min-w-0 grow bg-transparent focus:outline-none"
		bind:value={message}
	/>
	<hr class="absolute bottom-16 left-4 right-4 bg-slate-200 peer-focus:hidden" />
</form>
