import { env } from '$env/dynamic/private';
import { json, type RequestHandler } from '@sveltejs/kit';
import seed from './seed';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { url, options } = await request.json();
		const documents = await seed(url, 1, env.PINECONE_INDEX, options);
		return json({ documents });
	} catch (error) {
		return json({ error: `An error occurred while processing context: ${error}` }, { status: 500 });
	}
};
