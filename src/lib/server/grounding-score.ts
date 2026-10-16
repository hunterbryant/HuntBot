import { env } from '$env/dynamic/private';
import { captureServerEvent } from '$lib/server/posthog';
import { createOpenAI } from '@ai-sdk/openai';
import { experimental_decide, Experimental_DecisionRefusalError } from 'ai';

// Everything the reply could legitimately draw on, trimmed so one call stays small and fast.
const CONTEXT_MAX_CHARS = 12_000;
// Router and fallback search results are appended after the full site pages, so a plain
// head-slice would drop exactly the evidence those turns were answered from.
const CONTEXT_TAIL_CHARS = 5_000;
const ABOUT_MAX_CHARS = 6_000;
const TOOL_OUTPUT_MAX_CHARS = 2_000;
const GROUNDING_TIMEOUT_MS = 10_000;

// Ordered rubric; the Decisions API returns a probability-weighted score in [0, 3].
const GROUNDING_LEVELS = [
	'Contradicts the evidence, or its main claim appears nowhere in it',
	'Mostly unsupported: some claims trace to the evidence, but key ones do not',
	'Mostly supported: the main claims trace to the evidence, with minor unsupported details',
	'Fully supported: every factual claim traces to the evidence'
];

// The voice rules from the system prompt's "How Hunter talks" section, as one ordered rubric.
const VOICE_LEVELS = [
	'Off-voice: corporate jargon, chatbot pleasantries, markdown or lists, or a long multi-paragraph answer',
	'Mostly off-voice: several of those problems',
	'Mostly on-voice: plain, short and specific, with one small slip',
	'On-voice: plain text, one to three sentences (up to four for a hiring pitch), specific, no jargon or pleasantries'
];

const VISITOR_INTENTS = {
	recruiter: 'A recruiter or hiring manager evaluating Hunter for a role',
	client: 'Someone exploring freelance, contract or project work with Hunter',
	peer: 'A designer or builder interested in his craft, process or how this site was made',
	curious: 'A general visitor browsing out of curiosity',
	testing: 'Someone poking at the chatbot itself: jailbreaks, trick questions or off-topic tests'
};

/** Trim CONTEXT to the limit while keeping its end, where supplemental search results go. */
function headAndTail(text: string): string {
	if (text.length <= CONTEXT_MAX_CHARS) return text;
	const head = text.slice(0, CONTEXT_MAX_CHARS - CONTEXT_TAIL_CHARS);
	const tail = text.slice(-CONTEXT_TAIL_CHARS);
	return `${head}\n\n[… middle of CONTEXT omitted …]\n\n${tail}`;
}

/**
 * Cheap per-turn audit of every reply, sent to PostHog as `rag_grounding` (joined to
 * `chat_message` on run_id). One OpenAI Decisions call scores how well the reply is supported by
 * what the model was given — CONTEXT, the ABOUT HUNTER page and any server-tool output — and
 * whether it makes factual claims at all, so misses and small talk can be filtered out of the
 * score. The same call also checks the voice rules (third person, plain and short), catches
 * misses `MISS_PATTERN` doesn't, and guesses who the visitor is. Runs after the reply has
 * streamed, so it never adds visitor latency. `RAG_REFLECTION=1` is still there for
 * claim-by-claim citations; set `RAG_GROUNDING=0` to turn this off.
 *
 * Never throws: a failure (including a refusal, which fails every question in the call) is
 * sent as a `rag_grounding` event with `grounding_error` set, so failure rates are measurable,
 * and every outcome logs one `[HuntBot grounding]` line (scores only, no message text).
 */
export async function sendGroundingScoreToPosthog(options: {
	userMessage: string;
	priorUserMessages: string[];
	assistantText: string;
	contextText: string;
	aboutText: string | null;
	toolOutputs: { name: string; output: string }[];
	sessionId: string | null;
	runID: string;
	currentPage: string;
	lane: string | null;
	isAdmin: boolean;
}): Promise<void> {
	if (env.RAG_GROUNDING === '0') return;

	const { userMessage, assistantText, sessionId, runID } = options;
	if (!assistantText.trim()) return;

	const base = {
		user_message: userMessage,
		bot_response: assistantText,
		lane: options.lane,
		is_admin: options.isAdmin,
		current_page: options.currentPage,
		run_id: runID,
		session_id: sessionId
	};
	const started = performance.now();
	try {
		await scoreReply(options, base, started);
	} catch (err) {
		const refused = Experimental_DecisionRefusalError.isInstance(err);
		const error = err instanceof Error ? err.message : String(err);
		const decisionMs = Math.round(performance.now() - started);
		console.warn(
			'[HuntBot grounding]',
			JSON.stringify({ run_id: runID, error, refused, decisionMs })
		);
		await captureServerEvent('rag_grounding', sessionId ?? runID, {
			...base,
			grounding_error: error,
			grounding_refused: refused,
			decision_ms: decisionMs
		});
	}
}

async function scoreReply(
	options: Parameters<typeof sendGroundingScoreToPosthog>[0],
	base: Record<string, unknown>,
	started: number
): Promise<void> {
	const { userMessage, assistantText, sessionId, runID } = options;
	const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
	const { answers, usage } = await experimental_decide({
		model: openai.decisionModel('gpt-6-luna'),
		state: {
			visitor_message: userMessage,
			earlier_visitor_messages: options.priorUserMessages.slice(-5),
			reply: assistantText,
			evidence: {
				about_hunter: options.aboutText?.slice(0, ABOUT_MAX_CHARS) ?? '',
				context: headAndTail(options.contextText),
				tool_results: options.toolOutputs.map((t) => ({
					tool: t.name,
					output: t.output.slice(0, TOOL_OUTPUT_MAX_CHARS)
				}))
			}
		},
		questions: {
			makes_claims: {
				type: 'boolean',
				instructions:
					'Does the reply state facts about Hunter, his work, his life or this site (as opposed to only small talk, a clarifying question, or saying it does not know)?'
			},
			grounding: {
				type: 'score',
				instructions:
					"How well is the reply's factual content supported by the evidence (about_hunter, context, tool_results)? Judge support only, not tone or style.",
				criteria: GROUNDING_LEVELS
			},
			// The bot talks about Hunter in the third person; it is never Hunter himself.
			speaks_as_hunter: {
				type: 'boolean',
				instructions:
					'Does the reply speak as Hunter himself, in the first person ("I designed…", "my work"), rather than about him in the third person? "I" meaning the chatbot itself ("I don\'t have that") does not count.'
			},
			admits_miss: {
				type: 'boolean',
				instructions:
					"Does the reply say, in any wording, that it doesn't have or can't find the information the visitor asked for?"
			},
			voice: {
				type: 'score',
				instructions: 'How well does the reply follow this voice spec?',
				criteria: VOICE_LEVELS
			},
			visitor_intent: {
				type: 'choice',
				instructions:
					'Based on visitor_message and earlier_visitor_messages, who is this visitor most likely to be?',
				criteria: VISITOR_INTENTS
			}
		},
		abortSignal: AbortSignal.timeout(GROUNDING_TIMEOUT_MS)
	});

	const decisionMs = Math.round(performance.now() - started);

	const grounding = answers.grounding;
	const scores = {
		grounding_score: grounding.score,
		makes_claims_probability: answers.makes_claims.probability,
		speaks_as_hunter_probability: answers.speaks_as_hunter.probability,
		admits_miss_probability: answers.admits_miss.probability,
		voice_score: answers.voice.score,
		visitor_intent: answers.visitor_intent.choice
	};
	console.log(
		'[HuntBot grounding]',
		JSON.stringify({
			run_id: runID,
			...scores,
			decision_ms: decisionMs,
			input_tokens: usage.inputTokens ?? null
		})
	);

	await captureServerEvent('rag_grounding', sessionId ?? runID, {
		...base,
		...scores,
		grounding_probabilities: grounding.probabilities ?? null,
		visitor_intent_probabilities: answers.visitor_intent.probabilities ?? null,
		grounding_error: null,
		decision_ms: decisionMs,
		decision_input_tokens: usage.inputTokens ?? null
	});
}
