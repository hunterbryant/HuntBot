<script>
	import '../app.css';
	import studiobg from '$lib/assets/studiobg.webp';
	import ChatBox from '$lib/ChatBox.svelte';
</script>

<div
	class="relative h-full overflow-hidden rounded-none bg-slate-300 bg-[url('lib/assets/studiobg.webp')] bg-cover bg-center bg-no-repeat shadow-inner sm:rounded-[2rem]"
>
	<slot />
	<ChatBox />
</div>
