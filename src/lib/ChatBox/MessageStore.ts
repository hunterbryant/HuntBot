import { writable } from 'svelte/store';

export interface ChatObject {
	type: string;
	message: string;
	state: {
		completed: boolean;
	};
}

export const messages = writable<Array<ChatObject>>([]);
export const botEngaged = writable(false);
