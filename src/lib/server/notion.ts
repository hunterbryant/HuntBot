import { env } from '$env/dynamic/private';
import { Client } from '@notionhq/client';
import type { BlockObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import { warnOnce } from './warn-once';

// Notion, two ways. The embed job (routes/api/embed/notion-url) walks one database and indexes it
// into Qdrant; `searchNotion` below is the live path the chat tool uses, so anything the
// integration can see is reachable without re-indexing. Both share these page-to-text helpers.

export function getPlainText(richTextArray: Array<{ plain_text: string }>): string {
	return richTextArray.map((t) => t.plain_text).join('');
}

export function extractPageProperties(page: Record<string, unknown>): string {
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

		if (value) lines.push(`${key}: ${value}`);
	}

	return lines.join('\n');
}

export function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

// Notion's API averages ~3 requests/second; stay under that between calls
// so recursive block-children fetches don't trip rate limiting.
export const NOTION_REQUEST_SPACING_MS = 350;

export type BlockWalkLimits = {
	/** Pause between Notion requests. The embed job keeps 350ms; live search needs none. */
	spacingMs?: number;
	/** How many levels of child blocks to follow (0 = top level only). */
	maxDepth?: number;
	/** Stop once this many characters of text are collected. */
	maxChars?: number;
	/** Absolute time (Date.now() ms) after which the walk stops and returns what it has. */
	deadline?: number;
};

export async function getBlockChildren(
	notion: Client,
	blockId: string,
	limits: BlockWalkLimits = {}
): Promise<string> {
	const {
		spacingMs = NOTION_REQUEST_SPACING_MS,
		maxDepth = Infinity,
		maxChars = Infinity,
		deadline = Infinity
	} = limits;
	let chars = 0;
	const done = () => chars >= maxChars || Date.now() >= deadline;

	async function walk(id: string, depth: number): Promise<string> {
		const lines: string[] = [];
		let cursor: string | undefined;

		do {
			const response = await withRetry(() =>
				notion.blocks.children.list({ block_id: id, start_cursor: cursor, page_size: 100 })
			);
			if (spacingMs) await sleep(spacingMs);

			for (const block of response.results) {
				if (done()) break;
				const b = block as BlockObjectResponse;
				const text = blockToMarkdown(b);
				if (text) {
					lines.push(text);
					chars += text.length;
				}

				if (b.has_children && depth < maxDepth && !done()) {
					const childText = await walk(b.id, depth + 1);
					if (childText) lines.push(childText);
				}
			}

			cursor = response.has_more && !done() ? (response.next_cursor ?? undefined) : undefined;
		} while (cursor);

		return lines.join('\n');
	}

	return walk(blockId, 0);
}

export function blockToMarkdown(block: BlockObjectResponse): string {
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
		case 'quote':
		case 'callout':
			return `> ${text}`;
		case 'code':
			return `\`\`\`\n${text}\n\`\`\``;
		case 'divider':
			return '---';
		case 'bookmark':
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

export async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			return await fn();
		} catch (err) {
			const msg = String(err);
			const is429 = msg.includes('429') || msg.includes('rate') || msg.includes('quota');
			if (is429 && attempt < retries) {
				const delay = 2000 * Math.pow(2, attempt); // 2s, 4s, 8s
				console.warn(`Rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
				await new Promise((r) => setTimeout(r, delay));
				continue;
			}
			throw err;
		}
	}
	throw new Error('Unreachable');
}

// ---------------------------------------------------------------------------------------------
// Live search (the `search_notion` chat tool)

const SEARCH_PAGES = 5;
const READ_PAGES = 3;
const MAX_CHARS_PER_PAGE = 3000;
const MAX_CHARS_TOTAL = 8000;
const SEARCH_BUDGET_MS = 8000;
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 100;

export type NotionHit = { title: string; lastEdited: string; text: string };

export type NotionSearchResult =
	| { ok: true; hits: NotionHit[] }
	| { ok: false; reason: 'not_configured' | 'failed' };

const cache = new Map<string, { expires: number; hits: NotionHit[] }>();

function pageTitle(page: Record<string, unknown>): string {
	const properties = (page.properties ?? {}) as Record<string, Record<string, unknown>>;
	for (const prop of Object.values(properties)) {
		if (prop.type === 'title') {
			return getPlainText((prop.title as Array<{ plain_text: string }>) || []).trim() || 'Untitled';
		}
	}
	return 'Untitled';
}

/**
 * Searches everything the Notion integration can see and returns the text of the best few pages.
 * Never throws. Page links are deliberately left out: workspace URLs aren't public.
 */
export async function searchNotion(query: string): Promise<NotionSearchResult> {
	const token = env.NOTION_INTEGRATION_TOKEN;
	if (!token) {
		warnOnce(
			'notion-not-configured',
			'[HuntBot tools] search_notion is off: NOTION_INTEGRATION_TOKEN is not set'
		);
		return { ok: false, reason: 'not_configured' };
	}

	const key = query.trim().toLowerCase().replace(/\s+/g, ' ');
	const hit = cache.get(key);
	if (hit && hit.expires > Date.now()) return { ok: true, hits: hit.hits };

	const deadline = Date.now() + SEARCH_BUDGET_MS;
	try {
		const notion = new Client({ auth: token, timeoutMs: SEARCH_BUDGET_MS });
		const found = await withRetry(
			() =>
				notion.search({
					query,
					filter: { property: 'object', value: 'page' },
					page_size: SEARCH_PAGES
				}),
			1
		);

		const hits: NotionHit[] = [];
		let total = 0;
		for (const result of found.results.slice(0, READ_PAGES)) {
			if (Date.now() >= deadline || total >= MAX_CHARS_TOTAL) break;
			const page = result as unknown as Record<string, unknown>;
			const properties = extractPageProperties(page);
			const body = await getBlockChildren(notion, page.id as string, {
				spacingMs: 0,
				maxDepth: 2,
				maxChars: MAX_CHARS_PER_PAGE,
				deadline
			});
			const text = (properties ? `${properties}\n\n${body}` : body)
				.trim()
				.slice(0, Math.min(MAX_CHARS_PER_PAGE, MAX_CHARS_TOTAL - total));
			if (!text) continue;
			total += text.length;
			hits.push({
				title: pageTitle(page),
				lastEdited: String(page.last_edited_time ?? '').slice(0, 10),
				text
			});
		}

		if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
		cache.set(key, { expires: Date.now() + CACHE_TTL_MS, hits });
		return { ok: true, hits };
	} catch (error) {
		console.warn('[HuntBot tools] Notion search failed', {
			error: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200)
		});
		return { ok: false, reason: 'failed' };
	}
}
