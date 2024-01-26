<script lang="ts">
	import type { Content } from '@prismicio/client';

	export let slice: Content.GridGapSlice;
</script>

<div
	data-slice-type={slice.slice_type}
	data-slice-variation={slice.variation}
	class="group col-span-full hidden cursor-pointer flex-col sm:col-span-3 md:col-span-2 md:block"
></div>
