import { derived, writable } from 'svelte/store';

export const navEngaged = writable(false);
export const chatOpen = writable(false);
export const delayedNavEngaged = derived(
	[navEngaged, chatOpen],
	([$navEngaged, $chatOpen], set) => {
		if ($chatOpen) {
			setTimeout(() => {
				set($navEngaged);
			}, 300);
		} else {
			set($navEngaged);
		}
		return;
	},
	false
);
export const mobile = writable(true);
