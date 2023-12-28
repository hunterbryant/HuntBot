import { createClient } from '$lib/prismicio';

export async function load({ fetch, cookies }) {
	const client = createClient({ fetch, cookies });

	const page = await client.getSingle('information');

	return {
		page
	};
}

// export async function entries() {
// 	return [{}];
// }
