import { env } from '$env/dynamic/private';
import { QdrantClient } from '@qdrant/js-client-rest';
import { json, type RequestHandler } from '@sveltejs/kit';

export const POST: RequestHandler = async () => {
	try {
		const client = new QdrantClient({
			url: env.QDRANT_URL,
			apiKey: env.QDRANT_API_KEY
		});

		const result = await client.delete(env.QDRANT_COLLECTION as string, {
			filter: {
				must: [
					{
						key: 'metadata.source',
						match: { value: 'imessage' }
					}
				]
			}
		});

		return json({ success: true, result });
	} catch (err) {
		console.error('iMessage purge failed:', err);
		return json({ success: false, error: String(err) }, { status: 500 });
	}
};
