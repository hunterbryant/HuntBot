import { derived, writable } from 'svelte/store';

export const navEngaged = writable(false);
export const chatOpen = writable(false);
export const mobile = writable(true);

// Build in delay to await animation of closing chat box
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
