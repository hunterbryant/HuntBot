import { env } from '$env/dynamic/private';
import { OpenAIEmbeddings } from '@langchain/openai';
import { QdrantVectorStore } from '@langchain/qdrant';
import { json } from '@sveltejs/kit';
import { Document } from 'langchain/document';
import { MarkdownTextSplitter } from 'langchain/text_splitter';

// Repo docs that describe HuntBot's own architecture/tech stack — embedded so
// the bot can answer technical questions about itself with grounded context.
const REPO = 'hunterbryant/huntbot';
const BRANCH = 'main';
const FILES = ['CLAUDE.md', 'README.md'];

function rawUrl(file: string): string {
	return `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${file}`;
}

// Handle embedding of the HuntBot repo's own docs (CLAUDE.md, README.md) into Qdrant
export async function GET() {
	console.log('Server GitHub repo embed endpoint hit');

	const splitter = new MarkdownTextSplitter({ chunkSize: 1000, chunkOverlap: 200 });

	const fetched = await Promise.all(
		FILES.map(async (file) => {
			const res = await fetch(rawUrl(file));
			if (!res.ok) {
				console.warn(`Skipping ${file}: ${res.status}`);
				return null;
			}
			return { file, content: await res.text() };
		})
	);

	const docs = (
		await Promise.all(
			fetched
				.filter((f): f is NonNullable<typeof f> => f !== null && f.content.trim().length > 0)
				.map(({ file, content }) =>
					splitter.splitDocuments([
						new Document({
							pageContent: content,
							metadata: {
								source: 'github',
								title: `${REPO} — ${file}`,
								url: `https://github.com/${REPO}/blob/${BRANCH}/${file}`
							}
						})
					])
				)
		)
	).flat();

	if (docs.length === 0) {
		return json({ error: 'No repo docs could be fetched' }, { status: 500 });
	}

	await QdrantVectorStore.fromDocuments(
		docs,
		new OpenAIEmbeddings({
			modelName: 'text-embedding-3-small',
			openAIApiKey: env.OPENAI_API_KEY,
			dimensions: 512
		}),
		{
			url: env.QDRANT_URL,
			apiKey: env.QDRANT_API_KEY,
			collectionName: env.QDRANT_COLLECTION
		}
	)
		.then(() => console.log('Embeddings loaded'))
		.catch((error) => {
			console.log(error);
			return json({ error: `Failed to load embeddings: ${error}` }, { status: 500 });
		});

	return json(`Embedded ${docs.length} chunks from GitHub repo docs`, { status: 200 });
}
