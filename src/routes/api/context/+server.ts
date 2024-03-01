import { getContext } from '$lib/utilities/context';
import type { ScoredPineconeRecord } from '@pinecone-database/pinecone';
import { json, type RequestHandler } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { messages } = await request.json();
		const lastMessage = messages.length > 1 ? messages[messages.length - 1] : messages[0];
		const context = (await getContext(
			lastMessage.content,
			'',
			10000,
			0.7,
			false
		)) as ScoredPineconeRecord[];
		return json({ context });
	} catch (error) {
		return json({ error: `An error occurred while processing context: ${error}` }, { status: 500 });
	}
};
