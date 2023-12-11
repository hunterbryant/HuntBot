import { writable } from 'svelte/store';

interface ChatObject {
	type: string;
	message: string;
}

export const messages = writable<Array<ChatObject>>([]);
