<script lang="ts">
	import '../app.css';
	import ChatBox from '$lib/ChatBox/ChatBox.svelte';
	import lettermark from '$lib/assets/lettermark.svg';
</script>

<div class="grid grid-cols-5 gap-4 px-2 sm:grid-cols-9 sm:px-16">
	<div class="col-span-3">
		<img src={lettermark} alt="Hunters lettermark logo" class="mt-16" />
		<div class="inline-flex w-full justify-between gap-4">
			<h3>How?</h3>
			<button class="h-12 rounded bg-blue-600 px-3 text-stone-50">Ask HuntBot</button>
		</div>
		<!-- <ChatBox /> -->
	</div>
	<slot />
</div>
