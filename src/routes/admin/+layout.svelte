<script lang="ts">
	import { onMount } from 'svelte';
	import { markAdminBrowser } from '$lib/analytics';

	// Only reachable with an admin cookie (hooks.server.ts), so this is Hunter's browser
	onMount(markAdminBrowser);
</script>

<slot />
