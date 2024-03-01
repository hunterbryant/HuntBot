import { PINECONE_INDEX } from '$env/static/private';
import seed from './seed';
import { json, type RequestHandler } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { url, options } = await request.json();
		const documents = await seed(url, 1, PINECONE_INDEX, options);
		return json({ documents });
	} catch (error) {
		return json({ error: `An error occurred while processing context: ${error}` }, { status: 500 });
	}
};
