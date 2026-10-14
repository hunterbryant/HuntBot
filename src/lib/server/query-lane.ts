import { env } from '$env/dynamic/private';
import { logRag } from '$lib/server/rag-debug';
import { embedQueryText, getEmbeddings } from '$lib/utilities/context';

/**
 * Adaptive compute lanes for the chat pipeline (after Adaptive-RAG, Jeong et al. 2024):
 * classify the incoming message by how much work it needs, then only pay for that much.
 *
 * - quick:    overview / navigation / small-talk ("tell me about him", "show me his projects").
 *             No HyDE, no LLM rerank, no router — vector search + a fast model.
 * - standard: the default. Full retrieval pipeline, main model at low reasoning effort.
 * - deep:     open-ended analytical questions. Full pipeline, main model at higher effort.
 *
 * Classification is a nearest-neighbour lookup against the exemplar questions below using
 * the same embedding model as retrieval, so it costs one embedding call (which quick-lane
 * retrieval then reuses) instead of an extra LLM round trip. Set QUERY_LANES=0 to send
 * everything down the standard lane.
 */
export type QueryLane = 'quick' | 'standard' | 'deep';

export type LaneDecision = {
	lane: QueryLane;
	/** Best cosine similarity to a quick / deep exemplar — logged so thresholds can be tuned. */
	quickScore: number;
	deepScore: number;
	/** Embedding of the raw message; reusable as the retrieval vector when no rewrite is needed. */
	embedding: number[] | null;
};

const QUICK_EXEMPLARS = [
	'Tell me about him',
	'Who is Hunter?',
	"What's his background?",
	'Where did he go to school?',
	'What does he do?',
	'Show me his projects',
	'Show me his work',
	'Take me to his case studies',
	'Where does he work now?',
	'How can I contact him?',
	'Is he open to new roles?',
	'What is this site?',
	'What are you?',
	'Show me his resume',
	'What are his skills?',
	'Go to the homepage'
];

const DEEP_EXEMPLARS = [
	'How does his approach to user research differ across his projects?',
	'Compare his work at different companies and what he learned from each',
	"What's his design philosophy and how does it show up in his case studies?",
	'Walk me through his end-to-end design process on a complex project',
	'What tradeoffs did he make on that project and why?',
	'How has his design style evolved over his career?',
	'What would he bring to a team building a developer tools product?',
	'Critique the strengths and weaknesses of his portfolio',
	'How does he balance business goals with user needs in practice?',
	'Explain how this chatbot is architected and why it was built that way'
];

// Conservative thresholds: misrouting a real question into the quick lane costs answer
// quality, so it needs a close match. Tune from the `[HuntBot timing]` log lines.
const QUICK_THRESHOLD = 0.75;
const DEEP_THRESHOLD = 0.62;
// Long messages are rarely "quick" even if they open like an overview request.
const QUICK_MAX_CHARS = 60;

type Exemplar = { lane: 'quick' | 'deep'; vector: number[] };
let exemplarVectors: Promise<Exemplar[]> | null = null;

function loadExemplars(): Promise<Exemplar[]> {
	if (!exemplarVectors) {
		const texts = [...QUICK_EXEMPLARS, ...DEEP_EXEMPLARS];
		exemplarVectors = getEmbeddings()
			.embedDocuments(texts)
			.then((vectors) =>
				vectors.map((vector, i) => ({
					lane: i < QUICK_EXEMPLARS.length ? ('quick' as const) : ('deep' as const),
					vector
				}))
			)
			.catch((err) => {
				// Don't cache a failure — retry on the next request.
				exemplarVectors = null;
				throw err;
			});
	}
	return exemplarVectors;
}

function cosine(a: number[], b: number[]): number {
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		na += a[i] * a[i];
		nb += b[i] * b[i];
	}
	return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export async function classifyQueryLane(message: string): Promise<LaneDecision> {
	if (env.QUERY_LANES === '0') {
		return { lane: 'standard', quickScore: 0, deepScore: 0, embedding: null };
	}

	try {
		const [exemplars, embedding] = await Promise.all([loadExemplars(), embedQueryText(message)]);

		let quickScore = 0;
		let deepScore = 0;
		for (const ex of exemplars) {
			const score = cosine(embedding, ex.vector);
			if (ex.lane === 'quick') quickScore = Math.max(quickScore, score);
			else deepScore = Math.max(deepScore, score);
		}

		let lane: QueryLane = 'standard';
		if (
			quickScore >= QUICK_THRESHOLD &&
			quickScore > deepScore &&
			message.trim().length <= QUICK_MAX_CHARS
		) {
			lane = 'quick';
		} else if (deepScore >= DEEP_THRESHOLD && deepScore > quickScore) {
			lane = 'deep';
		}

		logRag('query lane', { lane, quickScore, deepScore });
		return { lane, quickScore, deepScore, embedding };
	} catch (err) {
		console.warn('Query lane classification failed, defaulting to standard:', err);
		return { lane: 'standard', quickScore: 0, deepScore: 0, embedding: null };
	}
}
