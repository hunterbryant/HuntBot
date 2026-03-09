import { env } from '$env/dynamic/private';
import { OpenAIEmbeddings } from '@langchain/openai';
import { QdrantVectorStore } from '@langchain/qdrant';
import { Client } from '@notionhq/client';
import type { BlockObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import { Document } from 'langchain/document';
import { MarkdownTextSplitter } from 'langchain/text_splitter';

const DATABASE_ID = '637fbb5a0236401fa1ee8e5e05775b5e';

function getPlainText(richTextArray: Array<{ plain_text: string }>): string {
	return richTextArray.map((t) => t.plain_text).join('');
}

function extractPageProperties(page: Record<string, unknown>): string {
	const properties = page.properties as Record<string, Record<string, unknown>>;
	const lines: string[] = [];

	for (const [key, prop] of Object.entries(properties)) {
		const type = prop.type as string;
		let value = '';

		if (type === 'title') {
			value = getPlainText((prop.title as Array<{ plain_text: string }>) || []);
		} else if (type === 'rich_text') {
			value = getPlainText((prop.rich_text as Array<{ plain_text: string }>) || []);
		} else if (type === 'select' && prop.select) {
			value = (prop.select as { name: string }).name;
		} else if (type === 'multi_select') {
			value = ((prop.multi_select as Array<{ name: string }>) || []).map((s) => s.name).join(', ');
		} else if (type === 'number' && prop.number != null) {
			value = String(prop.number);
		} else if (type === 'date' && prop.date) {
			const d = prop.date as { start: string; end?: string };
			value = d.end ? `${d.start} → ${d.end}` : d.start;
		} else if (type === 'url' && prop.url) {
			value = prop.url as string;
		} else if (type === 'checkbox') {
			value = prop.checkbox ? 'Yes' : 'No';
		} else if (type === 'email' && prop.email) {
			value = prop.email as string;
		} else if (type === 'phone_number' && prop.phone_number) {
			value = prop.phone_number as string;
		} else if (type === 'status' && prop.status) {
			value = (prop.status as { name: string }).name;
		}

		if (value) {
			lines.push(`${key}: ${value}`);
		}
	}

	return lines.join('\n');
}

async function getBlockChildren(notion: Client, blockId: string): Promise<string> {
	const lines: string[] = [];
	let cursor: string | undefined;

	do {
		const response = await notion.blocks.children.list({
			block_id: blockId,
			start_cursor: cursor,
			page_size: 100
		});

		for (const block of response.results) {
			const b = block as BlockObjectResponse;
			const text = blockToMarkdown(b);
			if (text) lines.push(text);

			if (b.has_children) {
				const childText = await getBlockChildren(notion, b.id);
				if (childText) lines.push(childText);
			}
		}

		cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
	} while (cursor);

	return lines.join('\n');
}

function blockToMarkdown(block: BlockObjectResponse): string {
	const type = block.type;
	const data = block[type as keyof typeof block] as Record<string, unknown> | undefined;
	if (!data) return '';

	const richText = data.rich_text as Array<{ plain_text: string }> | undefined;
	const text = richText ? getPlainText(richText) : '';

	switch (type) {
		case 'paragraph':
			return text;
		case 'heading_1':
			return `# ${text}`;
		case 'heading_2':
			return `## ${text}`;
		case 'heading_3':
			return `### ${text}`;
		case 'bulleted_list_item':
			return `- ${text}`;
		case 'numbered_list_item':
			return `1. ${text}`;
		case 'to_do': {
			const checked = (data.checked as boolean) ? 'x' : ' ';
			return `- [${checked}] ${text}`;
		}
		case 'toggle':
			return `> ${text}`;
		case 'quote':
			return `> ${text}`;
		case 'callout':
			return `> ${text}`;
		case 'code':
			return `\`\`\`\n${text}\n\`\`\``;
		case 'divider':
			return '---';
		case 'bookmark':
			return (data.url as string) || '';
		case 'link_preview':
			return (data.url as string) || '';
		case 'table_row': {
			const cells = data.cells as Array<Array<{ plain_text: string }>>;
			return '| ' + cells.map((cell) => getPlainText(cell)).join(' | ') + ' |';
		}
		default:
			return text;
	}
}

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
					const response = await notion.databases.query({
						database_id: DATABASE_ID,
						start_cursor: cursor,
						page_size: 100
					});

					pages.push(...(response.results as Record<string, unknown>[]));
					cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
				} while (cursor);

				const total = pages.length;
				send('status', { stage: 'loading', message: `Found ${total} pages`, total });

				// 2. Load each page's content
				const documents: Document[] = [];
				let loaded = 0;
				let skipped = 0;

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
							documents.push(
								new Document({
									pageContent: fullContent,
									metadata: {
										source: 'notion',
										notionId: page.id as string,
										title: pageTitle
									}
								})
							);
						}

						loaded++;
						send('progress', {
							stage: 'loading',
							current: loaded + skipped,
							total,
							title: pageTitle
						});
					} catch (err) {
						skipped++;
						console.warn(`Skipping page ${page.id}: ${err}`);
						send('progress', {
							stage: 'loading',
							current: loaded + skipped,
							total,
							title: `Skipped: ${page.id}`,
							skipped: true
						});
					}
				}

				// 3. Split into chunks
				send('status', {
					stage: 'splitting',
					message: `Splitting ${documents.length} documents into chunks...`
				});

				const splitter = new MarkdownTextSplitter({
					chunkSize: 1000,
					chunkOverlap: 200
				});

				const splitDocs = await splitter.splitDocuments(documents);

				send('status', {
					stage: 'embedding',
					message: `Embedding ${splitDocs.length} chunks into Qdrant...`
				});

				// 4. Embed and store in Qdrant
				await QdrantVectorStore.fromDocuments(
					splitDocs,
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
				);

				send('done', {
					message: `Embedded ${documents.length} pages (${splitDocs.length} chunks)`,
					pages: documents.length,
					chunks: splitDocs.length,
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
