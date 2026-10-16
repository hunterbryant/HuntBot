import { env } from '$env/dynamic/private';
import { CONFIG_POINT_ID } from '$lib/server/imessage-config';
import { getPointVectorForUpsert, getQdrantClient } from '$lib/server/qdrant-search';
import { createOpenAI } from '@ai-sdk/openai';
import {
	experimental_decide,
	Experimental_DecisionRefusalError,
	type Experimental_DecisionQuestion
} from 'ai';

/**
 * Quality + privacy tags on knowledge-base chunks, written in place as `metadata.audit` with
 * Qdrant set_payload — vectors are never touched, so nothing needs re-embedding. The "Audit"
 * button on /admin/embeddings (`POST /api/admin/chunk-audit`) tags whatever isn't tagged yet,
 * in the background; run it after indexing so new chunks get checked too.
 * Retrieval then skips chunks flagged `low_value` or `sensitive` (see `isExcludedByAudit`).
 * Bump CHUNK_AUDIT_VERSION after changing the rubric to re-audit everything.
 */
export const CHUNK_AUDIT_VERSION = 1;

export type ChunkAudit = {
	v: number;
	/** Probability-weighted 0–3 (boilerplate → rich); null when not judged. */
	substance: number | null;
	low_value: boolean;
	/** Notes / iMessage only — site pages are public already. */
	sensitive_probability: number | null;
	sensitive: boolean;
	/** The model declined to judge it; kept in retrieval, never retried until the next version. */
	refused?: boolean;
	at: string;
};

// Under this, a chunk is mostly nav/footer/filler and only crowds real content out of the top-k.
const LOW_VALUE_MAX_SUBSTANCE = 0.75;
// Dropping a real answer is costly, so only exclude chunks the model is fairly sure about.
const SENSITIVE_MIN_PROBABILITY = 0.8;

const CHUNKS_PER_CALL = 8;
const JUDGED_TEXT_CHARS = 3000;
const SCROLL_PAGE = 64;

const SUBSTANCE_LEVELS = [
	'Boilerplate: navigation, footer, cookie or legal text, link lists, repeated headers, or a fragment with no content of its own',
	'Thin: a few words of real content, mostly filler',
	'Useful: real information about Hunter, his work, his life or this site',
	'Rich: specific, substantive detail such as projects, decisions, outcomes, opinions or facts'
];

const SENSITIVE_INSTRUCTIONS =
	"Does this excerpt contain sensitive personal information that shouldn't be shown to an anonymous website visitor: contact details (phone numbers, home addresses, personal emails), financial, medical or legal details, passwords or access codes, or private details about someone other than Hunter?";

/** True when an audit says retrieval should leave this chunk out. Untagged chunks stay in. */
export function isExcludedByAudit(metadata: Record<string, unknown> | undefined): boolean {
	const audit = metadata?.audit as Partial<ChunkAudit> | undefined;
	return audit?.low_value === true || audit?.sensitive === true;
}

type Chunk = { id: string | number; text: string; isSite: boolean };

// Progress of the background audit, kept in Qdrant like the iMessage toggle so the admin page
// can show it from any device and after the page that started it is closed.
const STATUS_POINT_ID = 'a0000000-0000-0000-0000-000000000002';
const VECTOR_DIMS = 512;

export type ChunkAuditStatus = {
	state: 'running' | 'done' | 'error';
	startedAt: string;
	/** Bumped after every ~45s run; a stale value while `running` means the chain stopped. */
	updatedAt: string;
	finishedAt: string | null;
	audited: number;
	lowValue: number;
	sensitive: number;
	refused: number;
	error: string | null;
};

export async function getChunkAuditStatus(): Promise<ChunkAuditStatus | null> {
	const [point] = await getQdrantClient().retrieve(env.QDRANT_COLLECTION!, {
		ids: [STATUS_POINT_ID],
		with_payload: true,
		with_vector: false
	});
	return (point?.payload?.chunkAudit as ChunkAuditStatus | undefined) ?? null;
}

export async function saveChunkAuditStatus(status: ChunkAuditStatus): Promise<void> {
	const client = getQdrantClient();
	const collection = env.QDRANT_COLLECTION!;
	const vector = await getPointVectorForUpsert(client, collection, new Array(VECTOR_DIMS).fill(0));
	await client.upsert(collection, {
		points: [{ id: STATUS_POINT_ID, vector, payload: { type: '_config', chunkAudit: status } }]
	});
}

function judgedText(payload: Record<string, unknown>): string | null {
	const meta = (payload.metadata ?? {}) as Record<string, unknown>;
	// iMessage chunks show `expandedContext` to the model, so that's what gets judged.
	const shown = typeof meta.expandedContext === 'string' ? meta.expandedContext : payload.content;
	return typeof shown === 'string' && shown.trim() ? shown.slice(0, JUDGED_TEXT_CHARS) : null;
}

async function auditBatch(chunks: Chunk[]): Promise<Map<Chunk['id'], ChunkAudit>> {
	const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
	const questions: Record<string, Experimental_DecisionQuestion> = {};
	chunks.forEach((chunk, i) => {
		questions[`substance_${i}`] = {
			type: 'score',
			instructions: `How much real content does excerpt chunk_${i} carry for answering questions about Hunter Bryant?`,
			criteria: SUBSTANCE_LEVELS
		};
		if (!chunk.isSite) {
			questions[`sensitive_${i}`] = {
				type: 'boolean',
				instructions: `Excerpt chunk_${i}: ${SENSITIVE_INSTRUCTIONS}`
			};
		}
	});

	const { answers } = await experimental_decide({
		model: openai.decisionModel('gpt-6-luna'),
		state: {
			excerpts: chunks.map((chunk, i) => ({ id: `chunk_${i}`, text: chunk.text }))
		},
		questions
	});

	const at = new Date().toISOString();
	const audits = new Map<Chunk['id'], ChunkAudit>();
	chunks.forEach((chunk, i) => {
		const substanceAnswer = answers[`substance_${i}`];
		const sensitiveAnswer = answers[`sensitive_${i}`];
		const substance = substanceAnswer?.type === 'score' ? substanceAnswer.score : null;
		const sensitiveProbability =
			sensitiveAnswer?.type === 'boolean' ? sensitiveAnswer.probability : null;
		audits.set(chunk.id, {
			v: CHUNK_AUDIT_VERSION,
			substance,
			low_value: substance !== null && substance < LOW_VALUE_MAX_SUBSTANCE,
			sensitive_probability: sensitiveProbability,
			sensitive: sensitiveProbability !== null && sensitiveProbability >= SENSITIVE_MIN_PROBABILITY,
			at
		});
	});
	return audits;
}

/**
 * One refusal fails every question in a decide call, so a refused batch is retried chunk by
 * chunk, and a chunk that's still refused gets marked as such instead of blocking the queue.
 */
async function auditWithRefusalFallback(chunks: Chunk[]): Promise<Map<Chunk['id'], ChunkAudit>> {
	try {
		return await auditBatch(chunks);
	} catch (err) {
		if (!Experimental_DecisionRefusalError.isInstance(err)) throw err;
	}
	const audits = new Map<Chunk['id'], ChunkAudit>();
	for (const chunk of chunks) {
		try {
			for (const [id, audit] of await auditBatch([chunk])) audits.set(id, audit);
		} catch (err) {
			if (!Experimental_DecisionRefusalError.isInstance(err)) throw err;
			audits.set(chunk.id, {
				v: CHUNK_AUDIT_VERSION,
				substance: null,
				low_value: false,
				sensitive_probability: null,
				sensitive: false,
				refused: true,
				at: new Date().toISOString()
			});
		}
	}
	return audits;
}

export type ChunkAuditRun = {
	audited: number;
	lowValue: number;
	sensitive: number;
	refused: number;
	/** True when untagged chunks may remain for the next run. */
	more: boolean;
};

/** Tag untagged chunks until `budgetMs` runs out. Safe to run any number of times. */
export async function auditUntaggedChunks(budgetMs: number): Promise<ChunkAuditRun> {
	const started = Date.now();
	const client = getQdrantClient();
	const collection = env.QDRANT_COLLECTION;
	if (!collection) throw new Error('QDRANT_COLLECTION is not set');

	// Strict-mode clusters reject filters on unindexed fields. Creating an existing index is a
	// no-op error, so ignore failures here; a real problem shows up in the scroll below.
	await client
		.createPayloadIndex(collection, { field_name: 'metadata.audit.v', field_schema: 'integer' })
		.catch(() => {});

	const run: ChunkAuditRun = { audited: 0, lowValue: 0, sensitive: 0, refused: 0, more: false };

	while (Date.now() - started < budgetMs) {
		const { points } = await client.scroll(collection, {
			limit: SCROLL_PAGE,
			filter: {
				must_not: [
					{ has_id: [CONFIG_POINT_ID, STATUS_POINT_ID] },
					{ key: 'metadata.audit.v', match: { value: CHUNK_AUDIT_VERSION } }
				]
			},
			with_payload: ['content', 'metadata.source', 'metadata.expandedContext'],
			with_vector: false
		});
		if (points.length === 0) return run;

		const chunks: Chunk[] = [];
		for (const point of points) {
			const payload = (point.payload ?? {}) as Record<string, unknown>;
			const text = judgedText(payload);
			const source = (payload.metadata as Record<string, unknown> | undefined)?.source;
			if (text) {
				chunks.push({
					id: point.id,
					text,
					isSite: typeof source === 'string' && source.startsWith('https://www.hunterbryant.io')
				});
			}
		}

		for (let i = 0; i < chunks.length; i += CHUNKS_PER_CALL) {
			if (Date.now() - started >= budgetMs) {
				run.more = true;
				return run;
			}
			const audits = await auditWithRefusalFallback(chunks.slice(i, i + CHUNKS_PER_CALL));
			await client.batchUpdate(collection, {
				operations: [...audits].map(([id, audit]) => ({
					set_payload: { payload: { audit }, points: [id], key: 'metadata' }
				}))
			});
			for (const audit of audits.values()) {
				run.audited++;
				if (audit.low_value) run.lowValue++;
				if (audit.sensitive) run.sensitive++;
				if (audit.refused) run.refused++;
			}
		}

		// Points with no text can't be judged; tag them so the scroll doesn't keep returning them.
		const textless = points.filter((p) => !chunks.some((c) => c.id === p.id));
		if (textless.length > 0) {
			const audit: ChunkAudit = {
				v: CHUNK_AUDIT_VERSION,
				substance: null,
				low_value: false,
				sensitive_probability: null,
				sensitive: false,
				at: new Date().toISOString()
			};
			await client.setPayload(collection, {
				payload: { audit },
				points: textless.map((p) => p.id),
				key: 'metadata'
			});
		}
	}

	run.more = true;
	return run;
}
