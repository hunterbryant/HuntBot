import { OPENAI_API_KEY } from '$env/static/private';
import OpenAI from 'openai';

const openai = new OpenAI({
	apiKey: OPENAI_API_KEY
});

export async function getEmbeddings(input: string) {
	try {
		const response = await openai.embeddings.create({
			model: 'text-embedding-ada-002',
			input: input.replace(/\n/g, ' ')
		});

		const result = await response;
		return result.data[0].embedding as number[];
	} catch (e) {
		console.log('Error calling OpenAI embedding API: ', e);
		throw new Error(`Error calling OpenAI embedding API: ${e}`);
	}
}
