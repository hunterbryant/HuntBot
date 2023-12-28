import { derived, writable } from 'svelte/store';

export const navEngaged = writable(false);
export const chatOpen = writable(false);
export const delayedNavEngaged = derived(
	[navEngaged, chatOpen],
	([$navEngaged, $chatOpen], set) => {
		if ($chatOpen) {
			setTimeout(() => {
				return set($navEngaged);
			}, 300);
		} else {
			return set($navEngaged);
		}
	},
	false
);
export const mobile = writable(true);
