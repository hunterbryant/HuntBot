import { env } from '$env/dynamic/private';
import { logRag } from '$lib/server/rag-debug';
import { createOpenAI } from '@ai-sdk/openai';
import { experimental_decide } from 'ai';

// Everything the reply could legitimately draw on, trimmed so one call stays small and fast.
const CONTEXT_MAX_CHARS = 12_000;
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

/**
 * Cheap per-turn audit of every reply, sent to PostHog as `rag_grounding` (joined to
 * `chat_message` on run_id). One OpenAI Decisions call scores how well the reply is supported by
 * what the model was given — CONTEXT, the ABOUT HUNTER page and any server-tool output — and
 * whether it makes factual claims at all, so misses and small talk can be filtered out of the
 * score. The same call also checks the voice rules (third person, plain and short), catches
 * misses `MISS_PATTERN` doesn't, and guesses who the visitor is. Runs after the reply has
 * streamed, so it never adds visitor latency. `RAG_REFLECTION=1` is still there for
 * claim-by-claim citations; set `RAG_GROUNDING=0` to turn this off.
 */
export async function sendGroundingScoreToPosthog(options: {
	posthogKey: string;
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

	const { posthogKey, userMessage, assistantText, sessionId, runID } = options;
	if (!assistantText.trim()) return;

	const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
	const { answers } = await experimental_decide({
		model: openai.decisionModel('gpt-6-luna'),
		state: {
			visitor_message: userMessage,
			earlier_visitor_messages: options.priorUserMessages.slice(-5),
			reply: assistantText,
			evidence: {
				about_hunter: options.aboutText?.slice(0, ABOUT_MAX_CHARS) ?? '',
				context: options.contextText.slice(0, CONTEXT_MAX_CHARS),
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

	const grounding = answers.grounding;
	const makesClaims = answers.makes_claims;
	const properties = {
		grounding_score: grounding.score,
		grounding_probabilities: grounding.probabilities ?? null,
		makes_claims_probability: makesClaims.probability,
		speaks_as_hunter_probability: answers.speaks_as_hunter.probability,
		admits_miss_probability: answers.admits_miss.probability,
		voice_score: answers.voice.score,
		visitor_intent: answers.visitor_intent.choice,
		visitor_intent_probabilities: answers.visitor_intent.probabilities ?? null,
		user_message: userMessage,
		bot_response: assistantText,
		lane: options.lane,
		is_admin: options.isAdmin,
		current_page: options.currentPage,
		run_id: runID,
		session_id: sessionId
	};
	logRag('grounding score', {
		score: grounding.score,
		makesClaims: makesClaims.probability,
		speaksAsHunter: answers.speaks_as_hunter.probability,
		admitsMiss: answers.admits_miss.probability,
		voice: answers.voice.score,
		intent: answers.visitor_intent.choice
	});

	await fetch('https://us.i.posthog.com/capture/', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			api_key: posthogKey,
			event: 'rag_grounding',
			distinct_id: sessionId ?? runID,
			timestamp: new Date().toISOString(),
			properties
		})
	}).catch(() => {
		/* swallow */
	});
}
