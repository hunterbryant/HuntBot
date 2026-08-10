import { writable } from 'svelte/store';

// Kept separate from MessageStore.svelte.ts so the root layout can read/set
// chat visibility without pulling in the ai-sdk chat runtime on every page load.
export const botEngaged = writable(false);
export const minimized = writable(true);
