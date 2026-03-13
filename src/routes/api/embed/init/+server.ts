import { env } from '$env/dynamic/private';
import { QdrantClient } from '@qdrant/js-client-rest';
import { json } from '@sveltejs/kit';
import { createHybridCollection } from '$lib/utilities/embed.js';

export async function GET() {
	const client = new QdrantClient({ url: env.QDRANT_URL, apiKey: env.QDRANT_API_KEY });

	// Delete if exists
	try {
		await client.deleteCollection(env.QDRANT_COLLECTION);
	} catch {
		/* collection may not exist yet — that's fine */
	}

	await createHybridCollection(client, env.QDRANT_COLLECTION);

	return json({
		success: true,
		message: `Collection "${env.QDRANT_COLLECTION}" recreated with dense + sparse named vectors.`
	});
}
