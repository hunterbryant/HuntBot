import type { Actions } from './$types';

export const actions = {
	default: async (event) => {
		// TODO handle button action
		console.log('Indexing');
	}
} satisfies Actions;

export const prerender = false;
