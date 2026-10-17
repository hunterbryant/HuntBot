import { env } from '$env/dynamic/private';
import {
	extractPageProperties,
	getBlockChildren,
	NOTION_REQUEST_SPACING_MS,
	sleep,
	withRetry
} from '$lib/server/notion';
import { OpenAIEmbeddings } from '@langchain/openai';
import { QdrantVectorStore } from '@langchain/qdrant';
import { Client } from '@notionhq/client';
import { Document } from 'langchain/document';
import { MarkdownTextSplitter } from 'langchain/text_splitter';

const DATABASE_ID = '637fbb5a0236401fa1ee8e5e05775b5e';

export async function GET() {
	console.log('Server Notion embed API endpoint hit');

	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		async start(controller) {
			function send(event: string, data: Record<string, unknown>) {
				controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
			}

			try {
				const notion = new Client({ auth: env.NOTION_INTEGRATION_TOKEN });

				// 1. Query all pages
				send('status', { stage: 'querying', message: 'Querying Notion database...' });

				const pages: Record<string, unknown>[] = [];
				let cursor: string | undefined;

				do {
					const response = await withRetry(() =>
						notion.databases.query({
							database_id: DATABASE_ID,
							start_cursor: cursor,
							page_size: 100
						})
					);
					pages.push(...(response.results as Record<string, unknown>[]));
					cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
					if (cursor) await sleep(NOTION_REQUEST_SPACING_MS);
				} while (cursor);

				const total = pages.length;
				send('status', { stage: 'loading', message: `Found ${total} pages`, total });

				// 2. Validate env vars before touching any pages — fail fast instead of skipping everything
				if (!env.QDRANT_URL?.startsWith('http')) {
					throw new Error(
						`QDRANT_URL is missing or invalid: "${env.QDRANT_URL}". Must start with https://`
					);
				}
				if (!env.QDRANT_API_KEY) throw new Error('QDRANT_API_KEY is not set');
				if (!env.QDRANT_COLLECTION) throw new Error('QDRANT_COLLECTION is not set');

				const embeddings = new OpenAIEmbeddings({
					modelName: 'text-embedding-3-small',
					openAIApiKey: env.OPENAI_API_KEY,
					dimensions: 512
				});

				const splitter = new MarkdownTextSplitter({ chunkSize: 1000, chunkOverlap: 200 });

				const qdrantConfig = {
					url: env.QDRANT_URL,
					apiKey: env.QDRANT_API_KEY,
					collectionName: env.QDRANT_COLLECTION
				};

				// 3. Fetch each page and upload to Qdrant immediately — no buffering until the end
				let vectorStore: QdrantVectorStore | null = null;
				let loaded = 0;
				let skipped = 0;
				let totalChunks = 0;

				for (const page of pages) {
					try {
						const properties = extractPageProperties(page);
						const content = await getBlockChildren(notion, page.id as string);

						const pageTitle =
							properties
								.split('\n')
								.find((l) => l.startsWith('Name:') || l.startsWith('Title:'))
								?.split(': ')
								.slice(1)
								.join(': ') || 'Untitled';

						const fullContent = properties ? `${properties}\n\n${content}` : content;

						if (fullContent.trim()) {
							const chunks = await splitter.splitDocuments([
								new Document({
									pageContent: fullContent,
									metadata: { source: 'notion', notionId: page.id as string, title: pageTitle }
								})
							]);

							if (chunks.length > 0) {
								await withRetry(async () => {
									if (!vectorStore) {
										// First write — fromDocuments creates the Qdrant collection automatically
										vectorStore = await QdrantVectorStore.fromDocuments(
											chunks,
											embeddings,
											qdrantConfig
										);
									} else {
										await vectorStore.addDocuments(chunks);
									}
								});
								totalChunks += chunks.length;
							}
						}

						loaded++;
						send('progress', {
							stage: 'loading',
							current: loaded + skipped,
							total,
							title: pageTitle,
							chunks: totalChunks
						});
					} catch (err) {
						// Rethrow fatal errors that will affect all pages
						const msg = String(err);
						if (msg.includes('QdrantClientConfigError') || msg.includes('QdrantClient')) {
							throw err;
						}
						skipped++;
						console.warn(`Skipping page ${page.id}: ${err}`);
						send('progress', {
							stage: 'loading',
							current: loaded + skipped,
							total,
							title: `Skipped: ${page.id}`,
							skipped: true,
							chunks: totalChunks
						});
					}
				}

				send('done', {
					message: `Embedded ${loaded} pages (${totalChunks} chunks)`,
					pages: loaded,
					chunks: totalChunks,
					skipped
				});
			} catch (err) {
				send('error', { message: String(err) });
			} finally {
				controller.close();
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
}
