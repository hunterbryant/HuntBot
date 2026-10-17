import { env } from '$env/dynamic/private';
import { describeError } from '$lib/server/tool-log';
import { Client } from '@notionhq/client';
import type { BlockObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import { warnOnce } from './warn-once';

// Notion, two ways. The embed job (routes/api/embed/notion-url) walks one database and indexes it
// into Qdrant; `queryNotion` below is the live path the chat tool uses, so anything the
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
// Live querying (the `query_notion` chat tool)
//
// Text search alone can't answer "what did he do the last week of Sept": dates in a title aren't
// searchable text, and relevance ranking knows nothing about ranges. So the tool works like a
// small agent loop: find the database, read its schema, then run a typed query (date ranges,
// select/status values, sort) and read the matching pages. The model picks the filters; this
// file validates them against the real schema and answers mistakes with the valid choices, so it
// can correct itself on the next step instead of guessing.

const SEARCH_PAGES = 5;
const READ_PAGES = 3;
const QUERY_MAX_LIMIT = 10;
const QUERY_DEFAULT_LIMIT = 8;
const CONTENT_PAGES = 8;
const CONTENT_CONCURRENCY = 3;
const MAX_CHARS_PER_PAGE = 2000;
const MAX_CHARS_TOTAL = 8000;
const BUDGET_MS = 10_000;
const RESULT_TTL_MS = 5 * 60_000;
const SCHEMA_TTL_MS = 60 * 60_000;
const CACHE_MAX = 100;

export type NotionFilterOp =
	| 'equals'
	| 'not_equals'
	| 'contains'
	| 'not_contains'
	| 'before'
	| 'on_or_before'
	| 'after'
	| 'on_or_after'
	| 'is_empty'
	| 'is_not_empty';

export type NotionFilter = { property: string; op: NotionFilterOp; value?: string };

export type NotionRequest = {
	action: 'search' | 'describe' | 'query' | 'read';
	/** search: the words to look for. */
	query?: string;
	/** describe / query: a database name or id. */
	database?: string;
	filters?: NotionFilter[];
	sort_by?: string;
	sort_dir?: 'ascending' | 'descending';
	limit?: number;
	/** query: also read each matching page's body. */
	include_content?: boolean;
	/** read: the page to open. */
	page_id?: string;
};

export type NotionResult =
	| { ok: true; action: NotionRequest['action']; text: string; results: number }
	| {
			ok: false;
			reason: 'not_configured' | 'failed' | 'bad_request';
			/** What the model is told. For bad_request it lists the valid choices. */
			message: string;
	  };

type PropertySchema = { type: string; options?: string[] };
type DatabaseSchema = { id: string; title: string; properties: Record<string, PropertySchema> };

const resultCache = new Map<string, { expires: number; value: NotionResult }>();
const schemaCache = new Map<string, { expires: number; value: DatabaseSchema }>();
let databaseList: { expires: number; value: { id: string; title: string }[] } | null = null;

function remember<T>(
	map: Map<string, { expires: number; value: T }>,
	key: string,
	value: T,
	ttl: number
) {
	if (map.size >= CACHE_MAX) map.delete(map.keys().next().value as string);
	map.set(key, { expires: Date.now() + ttl, value });
}

function fresh<T>(map: Map<string, { expires: number; value: T }>, key: string): T | undefined {
	const hit = map.get(key);
	return hit && hit.expires > Date.now() ? hit.value : undefined;
}

function pageTitle(page: Record<string, unknown>): string {
	const properties = (page.properties ?? {}) as Record<string, Record<string, unknown>>;
	for (const prop of Object.values(properties)) {
		if (prop.type === 'title') {
			return getPlainText((prop.title as Array<{ plain_text: string }>) || []).trim() || 'Untitled';
		}
	}
	return 'Untitled';
}

const bad = (message: string): NotionResult => ({ ok: false, reason: 'bad_request', message });
const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

// --- databases and schemas ---------------------------------------------------------------------

async function listDatabases(notion: Client) {
	if (databaseList && databaseList.expires > Date.now()) return databaseList.value;
	const found = await withRetry(
		() =>
			notion.search({
				filter: { property: 'object', value: 'database' },
				page_size: 50
			}),
		1
	);
	const value = found.results.map((r) => {
		const db = r as unknown as { id: string; title?: Array<{ plain_text: string }> };
		return { id: db.id, title: getPlainText(db.title ?? []).trim() || 'Untitled' };
	});
	databaseList = { expires: Date.now() + SCHEMA_TTL_MS, value };
	return value;
}

/** Resolves a database name (exact, then partial, case-insensitive) or id to its id. */
async function resolveDatabase(
	notion: Client,
	ref: string
): Promise<{ id: string } | { error: string }> {
	if (UUID.test(ref.trim())) return { id: ref.trim() };
	const all = await listDatabases(notion);
	const want = ref.trim().toLowerCase();
	const match =
		all.find((d) => d.title.toLowerCase() === want) ??
		all.find((d) => d.title.toLowerCase().includes(want) || want.includes(d.title.toLowerCase()));
	if (match) return { id: match.id };
	return {
		error: all.length
			? `No database named "${ref}". Databases he has shared: ${all.map((d) => d.title).join(', ')}.`
			: 'No databases are shared with this integration.'
	};
}

async function getSchema(notion: Client, id: string): Promise<DatabaseSchema> {
	const cached = fresh(schemaCache, id);
	if (cached) return cached;
	const db = (await withRetry(
		() => notion.databases.retrieve({ database_id: id }),
		1
	)) as unknown as {
		id: string;
		title?: Array<{ plain_text: string }>;
		properties: Record<string, Record<string, unknown>>;
	};
	const properties: Record<string, PropertySchema> = {};
	for (const [name, prop] of Object.entries(db.properties)) {
		const type = prop.type as string;
		const config = prop[type] as { options?: Array<{ name: string }> } | undefined;
		properties[name] = {
			type,
			...(config?.options && { options: config.options.map((o) => o.name) })
		};
	}
	const value = { id: db.id, title: getPlainText(db.title ?? []).trim() || 'Untitled', properties };
	remember(schemaCache, id, value, SCHEMA_TTL_MS);
	return value;
}

function describeSchema(schema: DatabaseSchema): string {
	const lines = Object.entries(schema.properties).map(([name, p]) => {
		const filterable = FILTERABLE_TYPES.has(p.type) ? '' : ' (not filterable)';
		const options = p.options?.length ? `: ${p.options.join(' | ')}` : '';
		return `- ${name} [${p.type}]${options}${filterable}`;
	});
	return [
		`Database "${schema.title}" (id ${schema.id}). Properties:`,
		...lines,
		'Also filterable/sortable: created_time, last_edited_time.'
	].join('\n');
}

// --- filters -----------------------------------------------------------------------------------

const TEXT_TYPES = new Set(['title', 'rich_text', 'url', 'email', 'phone_number']);
const TEXT_OPS: Partial<Record<NotionFilterOp, string>> = {
	equals: 'equals',
	not_equals: 'does_not_equal',
	contains: 'contains',
	not_contains: 'does_not_contain',
	is_empty: 'is_empty',
	is_not_empty: 'is_not_empty'
};
const NUMBER_OPS: Partial<Record<NotionFilterOp, string>> = {
	equals: 'equals',
	not_equals: 'does_not_equal',
	after: 'greater_than',
	before: 'less_than',
	on_or_after: 'greater_than_or_equal_to',
	on_or_before: 'less_than_or_equal_to',
	is_empty: 'is_empty',
	is_not_empty: 'is_not_empty'
};
const DATE_OPS: Partial<Record<NotionFilterOp, string>> = {
	equals: 'equals',
	before: 'before',
	after: 'after',
	on_or_before: 'on_or_before',
	on_or_after: 'on_or_after',
	is_empty: 'is_empty',
	is_not_empty: 'is_not_empty'
};
const SELECT_OPS: Partial<Record<NotionFilterOp, string>> = {
	equals: 'equals',
	not_equals: 'does_not_equal',
	is_empty: 'is_empty',
	is_not_empty: 'is_not_empty'
};
const MULTI_OPS: Partial<Record<NotionFilterOp, string>> = {
	contains: 'contains',
	not_contains: 'does_not_contain',
	is_empty: 'is_empty',
	is_not_empty: 'is_not_empty'
};
const CHECKBOX_OPS: Partial<Record<NotionFilterOp, string>> = {
	equals: 'equals',
	not_equals: 'does_not_equal'
};

const FILTERABLE_TYPES = new Set([
	...TEXT_TYPES,
	'number',
	'date',
	'created_time',
	'last_edited_time',
	'select',
	'status',
	'multi_select',
	'checkbox'
]);

const DATE_VALUE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;
const NO_VALUE_OPS = new Set<NotionFilterOp>(['is_empty', 'is_not_empty']);

/**
 * Turns the model's flat filters into a Notion filter, checked against the database schema.
 * Pure, so it's testable without the API. Errors name the valid properties / options.
 */
export function buildFilter(
	schema: DatabaseSchema,
	filters: NotionFilter[]
): { filter?: Record<string, unknown> } | { error: string } {
	const built: Record<string, unknown>[] = [];
	const names = Object.keys(schema.properties);

	for (const f of filters) {
		const timestamp = f.property === 'created_time' || f.property === 'last_edited_time';
		const prop: PropertySchema | undefined = timestamp
			? { type: f.property }
			: (schema.properties[f.property] ??
				schema.properties[names.find((n) => n.toLowerCase() === f.property.toLowerCase()) ?? '']);
		if (!prop) {
			return {
				error: `No property "${f.property}" in "${schema.title}". Properties: ${names.join(', ')}, created_time, last_edited_time.`
			};
		}
		const name = timestamp
			? f.property
			: (names.find((n) => schema.properties[n] === prop) as string);
		if (!FILTERABLE_TYPES.has(prop.type)) {
			return { error: `Property "${name}" is a ${prop.type}, which can't be filtered.` };
		}

		const ops = TEXT_TYPES.has(prop.type)
			? TEXT_OPS
			: prop.type === 'number'
				? NUMBER_OPS
				: prop.type === 'date' || timestamp
					? DATE_OPS
					: prop.type === 'multi_select'
						? MULTI_OPS
						: prop.type === 'checkbox'
							? CHECKBOX_OPS
							: SELECT_OPS;
		const notionOp = ops[f.op];
		if (!notionOp) {
			return {
				error: `Operator "${f.op}" doesn't work on ${name} [${prop.type}]. Use: ${Object.keys(ops).join(', ')}.`
			};
		}

		let condition: unknown = true;
		if (!NO_VALUE_OPS.has(f.op)) {
			const value = f.value?.trim();
			if (value === undefined || value === '') {
				return { error: `Filter on "${name}" needs a value for "${f.op}".` };
			}
			if (prop.type === 'number') {
				const n = Number(value);
				if (!Number.isFinite(n)) return { error: `"${value}" isn't a number (property ${name}).` };
				condition = n;
			} else if (prop.type === 'date' || timestamp) {
				if (!DATE_VALUE.test(value)) {
					return { error: `Dates must be ISO like 2025-09-22 (property ${name}); got "${value}".` };
				}
				condition = value;
			} else if (prop.type === 'checkbox') {
				if (!/^(true|false|yes|no)$/i.test(value)) {
					return { error: `Checkbox ${name} takes true or false; got "${value}".` };
				}
				condition = /^(true|yes)$/i.test(value);
			} else if (prop.options) {
				const option = prop.options.find((o) => o.toLowerCase() === value.toLowerCase());
				if (!option) {
					return {
						error: `"${value}" isn't an option of ${name}. Options: ${prop.options.join(' | ')}.`
					};
				}
				condition = option;
			} else {
				condition = value;
			}
		}

		built.push(
			timestamp
				? { timestamp: f.property, [f.property]: { [notionOp]: condition } }
				: { property: name, [prop.type]: { [notionOp]: condition } }
		);
	}

	if (built.length === 0) return {};
	return { filter: built.length === 1 ? built[0] : { and: built } };
}

function buildSort(
	schema: DatabaseSchema,
	by: string | undefined,
	dir: 'ascending' | 'descending'
) {
	if (!by) return { sorts: undefined as undefined };
	if (by === 'created_time' || by === 'last_edited_time') {
		return { sorts: [{ timestamp: by, direction: dir }] as unknown[] };
	}
	const name = Object.keys(schema.properties).find((n) => n.toLowerCase() === by.toLowerCase());
	if (!name) {
		return {
			error: `Can't sort by "${by}". Properties: ${Object.keys(schema.properties).join(', ')}, created_time, last_edited_time.`
		};
	}
	return { sorts: [{ property: name, direction: dir }] as unknown[] };
}

// --- reading pages -----------------------------------------------------------------------------

/** Properties plus the start of the body, trimmed to `maxChars`. */
async function readPage(
	notion: Client,
	page: Record<string, unknown>,
	maxChars: number,
	deadline: number
): Promise<string> {
	const body = await getBlockChildren(notion, page.id as string, {
		spacingMs: 0,
		maxDepth: 2,
		maxChars,
		deadline
	});
	return body.trim().slice(0, maxChars);
}

/** Runs `fn` over `items` with a small concurrency, keeping order. */
async function mapLimit<T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>
): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (next < items.length) {
				const i = next++;
				out[i] = await fn(items[i]);
			}
		})
	);
	return out;
}

const edited = (page: Record<string, unknown>) => String(page.last_edited_time ?? '').slice(0, 10);

// --- actions -----------------------------------------------------------------------------------

async function runSearch(
	notion: Client,
	req: NotionRequest,
	deadline: number
): Promise<NotionResult> {
	const query = req.query?.trim();
	if (!query) return bad('search needs a query.');
	const found = await withRetry(
		() =>
			notion.search({
				query,
				filter: { property: 'object', value: 'page' },
				page_size: SEARCH_PAGES
			}),
		1
	);
	const pages = found.results as unknown as Record<string, unknown>[];
	if (pages.length === 0)
		return { ok: true, action: 'search', text: 'Nothing matched.', results: 0 };

	const dbNames = new Map((databaseList?.value ?? []).map((d) => [d.id, d.title]));
	const bodies = await mapLimit(pages.slice(0, READ_PAGES), CONTENT_CONCURRENCY, (p) =>
		readPage(notion, p, MAX_CHARS_PER_PAGE, deadline)
	);
	const lines = pages.map((page, i) => {
		const parent = page.parent as { type?: string; database_id?: string } | undefined;
		const inDb =
			parent?.type === 'database_id'
				? ` in database ${dbNames.get(parent.database_id ?? '') ?? parent.database_id}`
				: '';
		const head = `[${pageTitle(page)}] id ${page.id}, edited ${edited(page)}${inDb}`;
		const props = extractPageProperties(page);
		const text = [props, bodies[i]].filter(Boolean).join('\n\n');
		return text ? `${head}\n${text}` : head;
	});
	return { ok: true, action: 'search', text: lines.join('\n\n---\n\n'), results: pages.length };
}

async function runDescribe(notion: Client, req: NotionRequest): Promise<NotionResult> {
	if (!req.database) {
		const all = await listDatabases(notion);
		return {
			ok: true,
			action: 'describe',
			text: all.length
				? `Databases he has shared:\n${all.map((d) => `- ${d.title} (id ${d.id})`).join('\n')}`
				: 'No databases are shared with this integration.',
			results: all.length
		};
	}
	const resolved = await resolveDatabase(notion, req.database);
	if ('error' in resolved) return bad(resolved.error);
	const schema = await getSchema(notion, resolved.id);
	return { ok: true, action: 'describe', text: describeSchema(schema), results: 1 };
}

async function runQuery(
	notion: Client,
	req: NotionRequest,
	deadline: number
): Promise<NotionResult> {
	if (!req.database)
		return bad('query needs a database (a name or id). Use describe to list them.');
	const resolved = await resolveDatabase(notion, req.database);
	if ('error' in resolved) return bad(resolved.error);
	const schema = await getSchema(notion, resolved.id);

	const filter = buildFilter(schema, req.filters ?? []);
	if ('error' in filter) return bad(`${filter.error}\n${describeSchema(schema)}`);
	const sort = buildSort(schema, req.sort_by, req.sort_dir ?? 'ascending');
	if ('error' in sort) return bad(sort.error as string);

	const limit = Math.min(
		Math.max(Math.trunc(req.limit ?? QUERY_DEFAULT_LIMIT), 1),
		QUERY_MAX_LIMIT
	);
	const response = await withRetry(
		() =>
			notion.databases.query({
				database_id: schema.id,
				filter: filter.filter as never,
				sorts: sort.sorts as never,
				page_size: limit
			}),
		1
	);
	const pages = response.results as unknown as Record<string, unknown>[];
	if (pages.length === 0) {
		return { ok: true, action: 'query', text: `No rows in "${schema.title}" matched.`, results: 0 };
	}

	const readCount = req.include_content ? Math.min(pages.length, CONTENT_PAGES) : 0;
	const perPage = Math.min(
		MAX_CHARS_PER_PAGE,
		Math.floor(MAX_CHARS_TOTAL / Math.max(readCount, 1))
	);
	const bodies = await mapLimit(pages.slice(0, readCount), CONTENT_CONCURRENCY, (p) =>
		readPage(notion, p, perPage, deadline)
	);
	const rows = pages.map((page, i) => {
		const props = extractPageProperties(page);
		return [`#${i + 1} id ${page.id}, edited ${edited(page)}`, props, bodies[i]]
			.filter(Boolean)
			.join('\n');
	});
	const more = response.has_more
		? `\n\n(More rows exist; narrow the filters or raise limit up to ${QUERY_MAX_LIMIT}.)`
		: '';
	return {
		ok: true,
		action: 'query',
		text: `"${schema.title}", ${pages.length} row${pages.length === 1 ? '' : 's'}:\n\n${rows.join('\n\n---\n\n')}${more}`,
		results: pages.length
	};
}

async function runRead(
	notion: Client,
	req: NotionRequest,
	deadline: number
): Promise<NotionResult> {
	const id = req.page_id?.trim();
	if (!id || !UUID.test(id))
		return bad('read needs a page_id from an earlier search or query result.');
	const page = (await withRetry(
		() => notion.pages.retrieve({ page_id: id }),
		1
	)) as unknown as Record<string, unknown>;
	const body = await readPage(notion, page, MAX_CHARS_TOTAL, deadline);
	const props = extractPageProperties(page);
	return {
		ok: true,
		action: 'read',
		text: [`[${pageTitle(page)}] edited ${edited(page)}`, props, body].filter(Boolean).join('\n\n'),
		results: 1
	};
}

/**
 * The live Notion tool. One entry point so the model can chain search / describe / query / read
 * across steps. Never throws. Page links are left out on purpose: workspace URLs aren't public.
 */
export async function queryNotion(req: NotionRequest): Promise<NotionResult> {
	const token = env.NOTION_INTEGRATION_TOKEN;
	if (!token) {
		warnOnce(
			'notion-not-configured',
			'[HuntBot tools] query_notion is off: NOTION_INTEGRATION_TOKEN is not set'
		);
		return { ok: false, reason: 'not_configured', message: 'Notion is not connected.' };
	}

	const key = JSON.stringify(req);
	const cached = fresh(resultCache, key);
	if (cached) return cached;

	const deadline = Date.now() + BUDGET_MS;
	try {
		const notion = new Client({ auth: token, timeoutMs: BUDGET_MS });
		const result =
			req.action === 'search'
				? await runSearch(notion, req, deadline)
				: req.action === 'describe'
					? await runDescribe(notion, req)
					: req.action === 'query'
						? await runQuery(notion, req, deadline)
						: await runRead(notion, req, deadline);
		if (result.ok) remember(resultCache, key, result, RESULT_TTL_MS);
		return result;
	} catch (error) {
		console.warn('[HuntBot tools] Notion request failed', {
			action: req.action,
			error: describeError(error)
		});
		return { ok: false, reason: 'failed', message: 'Could not reach Notion right now.' };
	}
}
