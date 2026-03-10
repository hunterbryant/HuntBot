import { env } from '$env/dynamic/private';
import { OpenAIEmbeddings } from '@langchain/openai';
import { QdrantVectorStore } from '@langchain/qdrant';
import { QdrantClient } from '@qdrant/js-client-rest';
import { Document } from 'langchain/document';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';
import { readdirSync, existsSync } from 'fs';

const CHAT_DB_PATH = join(homedir(), 'Library', 'Messages', 'chat.db');

// --- Contacts auto-resolution ---
// Reads the macOS Address Book SQLite database to map phone numbers and emails
// to display names, so iMessage handles are resolved without manual aliases.

interface ABContact {
	Z_PK: number;
	ZFIRSTNAME: string | null;
	ZLASTNAME: string | null;
	ZNICKNAME: string | null;
	ZORGANIZATION: string | null;
}
interface ABPhone {
	ZOWNER: number;
	ZFULLNUMBER: string;
}
interface ABEmail {
	ZOWNER: number;
	ZADDRESS: string;
}

function findAddressBookDb(): string | null {
	// macOS stores the AB database under Sources/<uuid>/AddressBook-v22.abcddb
	const sourcesDir = join(
		homedir(),
		'Library',
		'Application Support',
		'AddressBook',
		'Sources'
	);
	try {
		if (existsSync(sourcesDir)) {
			for (const source of readdirSync(sourcesDir)) {
				const candidate = join(sourcesDir, source, 'AddressBook-v22.abcddb');
				if (existsSync(candidate)) return candidate;
			}
		}
	} catch {
		// fall through to direct path
	}
	const direct = join(
		homedir(),
		'Library',
		'Application Support',
		'AddressBook',
		'AddressBook-v22.abcddb'
	);
	return existsSync(direct) ? direct : null;
}

/** Normalise a phone number string to E.164 (+1XXXXXXXXXX) for matching against h.id. */
function normalisePhone(raw: string): string | null {
	const digits = raw.replace(/\D/g, '');
	if (digits.length === 10) return `+1${digits}`;
	if (digits.length === 11 && digits[0] === '1') return `+${digits}`;
	if (digits.length > 7) return `+${digits}`; // international fallback
	return null;
}

/** Build a handle-id → display-name map from the macOS Contacts database.
 *  Returns an empty map (non-fatal) if the DB is unavailable or inaccessible. */
function buildContactsMap(): Map<string, string> {
	const map = new Map<string, string>();
	const dbPath = findAddressBookDb();
	if (!dbPath) return map;

	try {
		const ab = new Database(dbPath, { readonly: true, fileMustExist: true });

		const contacts = ab
			.prepare(
				`SELECT Z_PK, ZFIRSTNAME, ZLASTNAME, ZNICKNAME, ZORGANIZATION
				 FROM ZABCDRECORD`
			)
			.all() as ABContact[];

		const nameById = new Map<number, string>();
		for (const c of contacts) {
			const fullName = [c.ZFIRSTNAME, c.ZLASTNAME].filter(Boolean).join(' ');
			const nickname = c.ZNICKNAME?.trim() || null;
			// If a nickname exists (e.g. "Mom"), embed as "Mom (Liz Bryant)" so both
			// the relational label and the real name are searchable in the same chunk.
			const name = nickname && fullName
				? `${nickname} (${fullName})`
				: nickname || fullName || c.ZORGANIZATION;
			if (name) nameById.set(c.Z_PK, name);
		}

		const phones = ab
			.prepare(`SELECT ZOWNER, ZFULLNUMBER FROM ZABCDPHONENUMBER WHERE ZFULLNUMBER IS NOT NULL`)
			.all() as ABPhone[];
		for (const p of phones) {
			const name = nameById.get(p.ZOWNER);
			if (!name) continue;
			const e164 = normalisePhone(p.ZFULLNUMBER);
			if (e164) map.set(e164, name);
		}

		const emails = ab
			.prepare(`SELECT ZOWNER, ZADDRESS FROM ZABCDEMAILADDRESS WHERE ZADDRESS IS NOT NULL`)
			.all() as ABEmail[];
		for (const e of emails) {
			const name = nameById.get(e.ZOWNER);
			if (!name) continue;
			map.set(e.ZADDRESS.toLowerCase(), name);
		}

		ab.close();
	} catch (err) {
		// Non-fatal — grant Contacts access in System Settings if needed
		console.warn('[imessage embed] Could not read Contacts database:', err);
	}

	return map;
}

interface MessageRow {
	ROWID: number;
	text: string | null;
	is_from_me: number;
	message_date: string;
	contact: string | null;
	chat_id: number | null;
	attributedBody: Buffer | null;
}

/** Extract plain text from attributedBody blob (Ventura+ stores message here instead of text).
 *  The blob is a typedstream-serialized NSAttributedString. The binary layout after
 *  "NSString" is: 01 94 84 01 2b <length> <text bytes> 86 84 ... NSDictionary.
 *  We locate the text by finding byte 0x2b (+), reading past the length prefix,
 *  then taking everything up to the 0x86 end marker. */
function extractTextFromAttributedBody(buf: Buffer | null): string {
	if (!buf || buf.length === 0) return '';

	const nsStringMarker = Buffer.from('NSString');

	const nsIdx = buf.indexOf(nsStringMarker);
	if (nsIdx === -1) return '';

	// Find the 0x2b (+) byte that precedes the length + text content
	const searchStart = nsIdx + nsStringMarker.length;
	const plusIdx = buf.indexOf(0x2b, searchStart);
	if (plusIdx === -1 || plusIdx > searchStart + 10) return '';

	// After the +, there's a length field:
	//   - Short form (< 0x80): single byte is the length
	//   - Long form (0x81 prefix): 0x81, then one byte length, then 0x00 separator
	let textStart = plusIdx + 1;
	const firstLenByte = buf[textStart];
	if (firstLenByte === undefined) return '';

	let textLen: number;
	if (firstLenByte === 0x81) {
		const actualLen = buf[textStart + 1];
		if (actualLen === undefined) return '';
		textLen = actualLen;
		// Skip 0x81, length byte, and the 0x00 separator
		textStart += 3;
	} else {
		textLen = firstLenByte;
		textStart += 1;
	}

	if (textLen <= 0 || textStart + textLen > buf.length) return '';

	return buf.slice(textStart, textStart + textLen).toString('utf8').trim();
}

/** Strip lone surrogates and other characters that break JSON serialization.
 *  Roundtrips through TextEncoder/TextDecoder to eliminate all invalid Unicode. */
function sanitizeText(str: string): string {
	const encoder = new TextEncoder();
	const decoder = new TextDecoder('utf-8', { fatal: false });
	// eslint-disable-next-line no-control-regex
	return decoder.decode(encoder.encode(str)).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFD]/g, '');
}

function getMessageText(row: MessageRow): string {
	if (row.text != null && row.text.trim() !== '') return sanitizeText(row.text);
	return sanitizeText(extractTextFromAttributedBody(row.attributedBody));
}

function buildQuery(days: number, onlyMe: boolean, excludeContacts: string[]): string {
	// Include messages that have EITHER text OR attributedBody (Ventura+ often uses only attributedBody)
	const conditions: string[] = [
		"(m.text IS NOT NULL AND m.text != '') OR (m.attributedBody IS NOT NULL AND length(m.attributedBody) > 0)"
	];

	if (days > 0) {
		const cutoff = (Date.now() / 1000 - 978307200 - days * 86400) * 1_000_000_000;
		conditions.push(`m.date > ${cutoff}`);
	}

	if (onlyMe) {
		conditions.push('m.is_from_me = 1');
	}

	if (excludeContacts.length > 0) {
		const escaped = excludeContacts.map((c) => `'${c.replace(/'/g, "''")}'`).join(',');
		conditions.push(`(h.id IS NULL OR h.id NOT IN (${escaped}))`);
	}

	return `
		SELECT
			m.ROWID,
			m.text,
			m.is_from_me,
			datetime(m.date/1000000000 + strftime('%s','2001-01-01'), 'unixepoch', 'localtime') AS message_date,
			h.id AS contact,
			cmj.chat_id,
			m.attributedBody AS attributedBody
		FROM message m
		LEFT JOIN handle h ON m.handle_id = h.ROWID
		LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
		WHERE ${conditions.join(' AND ')}
		ORDER BY m.date ASC
	`;
}

// Group messages by chat thread so the chunker sees conversational context together
function groupByChat(rows: MessageRow[]): Map<string, MessageRow[]> {
	const groups = new Map<string, MessageRow[]>();
	for (const row of rows) {
		const key = row.chat_id != null ? String(row.chat_id) : row.contact ?? 'unknown';
		let group = groups.get(key);
		if (!group) {
			group = [];
			groups.set(key, group);
		}
		group.push(row);
	}
	return groups;
}

/** Resolve all unique non-me contact ids from a chat thread to display names. */
function resolveParticipants(rows: MessageRow[], aliasMap: Map<string, string>): string[] {
	const seen = new Set<string>();
	for (const r of rows) {
		if (!r.is_from_me && r.contact) seen.add(aliasMap.get(r.contact) ?? r.contact);
	}
	return [...seen];
}

function formatMessages(
	rows: MessageRow[],
	participants: string[],
	aliasMap: Map<string, string>
): string {
	const isGroup = participants.length > 1;
	const header = isGroup
		? `Group conversation with: ${participants.join(', ')}`
		: `Conversation with: ${participants[0] ?? 'unknown'}`;

	const lines = rows
		.map((r) => {
			const body = getMessageText(r);
			if (!body) return null;
			const who = r.is_from_me
				? 'Hunter Bryant'
				: (aliasMap.get(r.contact ?? '') ?? r.contact ?? 'unknown');
			return `[${r.message_date}] ${who}: ${body}`;
		})
		.filter((line): line is string => line != null)
		.join('\n');

	return `${header}\n${lines}`;
}

/** Parse "id=Name, id2=Name2" into a Map for O(1) lookups. */
function parseAliases(raw: string): Map<string, string> {
	const map = new Map<string, string>();
	for (const entry of raw.split(',')) {
		const eq = entry.indexOf('=');
		if (eq === -1) continue;
		const id = entry.slice(0, eq).trim();
		const name = entry.slice(eq + 1).trim();
		if (id && name) map.set(id, name);
	}
	return map;
}

export async function GET({ url }) {
	const days = parseInt(url.searchParams.get('days') || '365', 10);
	const onlyMe = url.searchParams.get('onlyMe') !== 'false';
	const excludeRaw = url.searchParams.get('excludeContacts') || '';
	const excludeContacts = excludeRaw
		.split(',')
		.map((c) => c.trim())
		.filter(Boolean);
	// Auto-resolve from macOS Contacts DB, then let manual aliases win for overrides
	const contactsMap = buildContactsMap();
	const manualAliases = parseAliases(url.searchParams.get('contactAliases') || '');
	const aliasMap = new Map([...contactsMap, ...manualAliases]);

	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		async start(controller) {
			function send(event: string, data: Record<string, unknown>) {
				controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
			}

			try {
				send('status', { stage: 'opening', message: 'Opening iMessage database...' });

				let db: Database.Database;
				try {
					db = new Database(CHAT_DB_PATH, { readonly: true, fileMustExist: true });
				} catch (err) {
					throw new Error(
						`Cannot open chat.db — grant Full Disk Access to your terminal. ${err}`
					);
				}

				send('status', { stage: 'querying', message: 'Querying messages...' });

				const query = buildQuery(days, onlyMe, excludeContacts);
				const rawRows = db.prepare(query).all() as MessageRow[];
				db.close();

				const rows = rawRows.filter((r) => getMessageText(r).trim() !== '');
				const totalMessages = rows.length;
				send('status', {
					stage: 'processing',
					message: `Found ${totalMessages} messages`,
					total: totalMessages
				});

				if (totalMessages === 0) {
					send('done', { message: 'No messages matched filters', chunks: 0 });
					controller.close();
					return;
				}

				// Group by conversation and format
				const groups = groupByChat(rows);
				const documents: Document[] = [];

			for (const [chatKey, chatRows] of groups) {
				const participants = resolveParticipants(chatRows, aliasMap);
				if (participants.length === 0) continue;

				const isGroupChat = participants.length > 1;
				// Primary contact is the first (or only) participant — used as a terse label
				const primaryContact = participants[0];

				const text = formatMessages(chatRows, participants, aliasMap);
				if (!text.trim()) continue;

				// Parse year from the last message date ("YYYY-MM-DD ..." or similar)
				const lastDate = chatRows[chatRows.length - 1]?.message_date ?? '';
				const year = parseInt(lastDate.slice(0, 4), 10) || null;

				documents.push(
					new Document({
						pageContent: text,
						metadata: {
							source: 'imessage',
							contact: primaryContact,
							participants: participants.join(', '),
							isGroupChat: isGroupChat ? 1 : 0,
							chatId: chatKey,
							year,
							messageCount: chatRows.length,
							dateRange: `${chatRows[0]?.message_date} to ${lastDate}`
						}
					})
				);
			}

				send('status', {
					stage: 'chunking',
					message: `Chunking ${documents.length} conversations...`
				});

				// Small chunks for retrieval matching
				const splitter = new RecursiveCharacterTextSplitter({
					chunkSize: 3000,
					chunkOverlap: 500,
					separators: ['\nConversation with: ', '\n\n', '\n']
				});
				const chunks = await splitter.splitDocuments(documents);

				// For each chunk, store a wider context window in metadata so the LLM
				// gets full conversation context in production without needing chat.db.
				// We find where the chunk sits within its parent conversation and grab
				// a ±10,000 char window around it.
				const parentTextByChat = new Map<string, string>();
				const chunkCountByChatId = new Map<string, number>();
				for (const doc of documents) {
					parentTextByChat.set(String(doc.metadata.chatId), doc.pageContent);
				}
				// Count how many chunks each conversation produced so we can store totalChunks
				for (const chunk of chunks) {
					const key = String(chunk.metadata.chatId);
					chunkCountByChatId.set(key, (chunkCountByChatId.get(key) ?? 0) + 1);
				}
				const chunkIndexByChatId = new Map<string, number>();

				for (const chunk of chunks) {
					const chatKey = String(chunk.metadata.chatId);
					const chunkIndex = chunkIndexByChatId.get(chatKey) ?? 0;
					chunkIndexByChatId.set(chatKey, chunkIndex + 1);
					chunk.metadata.chunkIndex = chunkIndex;
					chunk.metadata.totalChunks = chunkCountByChatId.get(chatKey) ?? 1;

					const parentText = parentTextByChat.get(chatKey);
					if (!parentText) continue;

					const chunkStart = parentText.indexOf(chunk.pageContent.slice(0, 100));
					if (chunkStart === -1) {
						chunk.metadata.expandedContext = sanitizeText(parentText.slice(0, 15000));
						continue;
					}

					const windowStart = Math.max(0, chunkStart - 5000);
					const windowEnd = Math.min(parentText.length, chunkStart + chunk.pageContent.length + 5000);
					chunk.metadata.expandedContext = sanitizeText(parentText.slice(windowStart, windowEnd));
				}

				send('status', {
					stage: 'embedding',
					message: `Embedding ${chunks.length} chunks...`,
					totalChunks: chunks.length
				});

				if (!env.QDRANT_URL?.startsWith('http')) {
					throw new Error(
						`QDRANT_URL is missing or invalid: "${env.QDRANT_URL}"`
					);
				}
				if (!env.QDRANT_API_KEY) throw new Error('QDRANT_API_KEY is not set');
				if (!env.QDRANT_COLLECTION) throw new Error('QDRANT_COLLECTION is not set');

				const embeddings = new OpenAIEmbeddings({
					modelName: 'text-embedding-3-small',
					openAIApiKey: env.OPENAI_API_KEY,
					dimensions: 512
				});

				const qdrantConfig = {
					url: env.QDRANT_URL,
					apiKey: env.QDRANT_API_KEY,
					collectionName: env.QDRANT_COLLECTION
				};

				// Ensure payload index exists so filtering/purging by source works
				try {
					const qdrantClient = new QdrantClient({
						url: env.QDRANT_URL,
						apiKey: env.QDRANT_API_KEY
					});
					await qdrantClient.createPayloadIndex(env.QDRANT_COLLECTION as string, {
						field_name: 'metadata.source',
						field_schema: 'keyword'
					});
				} catch {
					// Index may already exist — safe to ignore
				}

				// Batch upload in groups of 50 to show progress
				const BATCH_SIZE = 50;
				let uploaded = 0;
				let vectorStore: QdrantVectorStore | null = null;

				for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
					const batch = chunks.slice(i, i + BATCH_SIZE);

					if (!vectorStore) {
						vectorStore = await QdrantVectorStore.fromExistingCollection(
							embeddings,
							qdrantConfig
						);
					}
					await vectorStore.addDocuments(batch);

					uploaded += batch.length;
					send('progress', {
						stage: 'embedding',
						current: uploaded,
						total: chunks.length,
						percent: Math.round((uploaded / chunks.length) * 100)
					});
				}

				send('done', {
					message: `Embedded ${totalMessages} messages across ${documents.length} conversations (${chunks.length} chunks)`,
					messages: totalMessages,
					conversations: documents.length,
					chunks: chunks.length
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
