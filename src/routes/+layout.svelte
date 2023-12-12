<script lang="ts">
	import '../app.css';
	import ChatBox from '$lib/ChatBox/ChatBox.svelte';
	import lettermark from '$lib/assets/lettermark.svg';
</script>

<div
	class="fixed inset-x-0 mx-auto grid h-full w-full max-w-screen-2xl grid-cols-5 gap-4 px-2 py-16 sm:grid-cols-9 sm:px-16"
>
	<div class="col-span-3 flex flex-col justify-stretch gap-4">
		<!-- This div covers the first vertical half of the nav bar -->
		<div class="flex-1">
			<img src={lettermark} alt="Hunters lettermark logo" />
		</div>
		<!-- This div covers the second half content -->
		<div class="flex flex-1 flex-col">
			<div class="inline-flex w-full grow justify-between gap-4">
				<h3 class="text-6xl font-bold tracking-tighter text-stone-800">How?</h3>
				<button class="h-12 rounded bg-blue-600 px-3 text-stone-50">Ask HuntBot</button>
			</div>
			<nav
				class="my-auto mb-16 flex flex-col gap-4 text-sm uppercase tracking-wider text-stone-900"
			>
				<a href="">Information</a>
				<a href="">Experience</a>
				<a href="">Case Studies</a>
				<a href="">Writing & Other Projects</a>
			</nav>
			<ul class="flex flex-col gap-4 text-sm uppercase tracking-wider text-stone-900">
				<a class="inline-flex justify-between" href=""
					>Linkedin
					<p>↗</p></a
				>
				<a class="inline-flex justify-between" href=""
					>Instagram
					<p>↗</p></a
				>
				<a class="inline-flex justify-between" href=""
					>Email
					<p>↗</p></a
				>
			</ul>
			<!-- <ChatBox /> -->
		</div>
	</div>
</div>
<slot />
