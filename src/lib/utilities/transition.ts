import { quintOut } from 'svelte/easing';
import { crossfade } from 'svelte/transition';

export const [send, receive] = crossfade({
	duration: (d) => Math.sqrt(d * 600),
	easing: quintOut,

	// When there isn't a corresponding key
	fallback(node) {
		const style = getComputedStyle(node);
		const transform = style.transform === 'none' ? '' : style.transform;

		return {
			duration: 600,
			easing: quintOut,
			css: (t) => `
              opacity: ${t}
              transform: ${transform} scale(${t});
            `
		};
	}
});
