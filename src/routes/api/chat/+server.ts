import { env } from '$env/dynamic/private';
import type { RagRouterPlan } from '$lib/schemas/ragRouter';
import { CALENDAR_TIMEZONE, formatEventTime, getCalendarEvents } from '$lib/server/calendar';
import {
	getRecentCommits,
	getRepoInfo,
	readRepoFile,
	searchRepoCode
} from '$lib/server/github-repo';
import { sendGroundingScoreToPosthog } from '$lib/server/grounding-score';
import { lookupIpOrg, type IpOrg } from '$lib/server/ip-org';
import { classifyModelFailure, type ModelFailure } from '$lib/server/model-errors';
import { captureServerEvent, isAnalyticsEnabled, runInBackground } from '$lib/server/posthog';
import { isSandboxAvailable, runPython } from '$lib/server/python-sandbox';
import { classifyQueryLane, type LaneDecision, type QueryLane } from '$lib/server/query-lane';
import { logRag } from '$lib/server/rag-debug';
import { sendRagReflectionToPosthog } from '$lib/server/rag-reflection';
import { planSupplementalSearches } from '$lib/server/rag-router';
import { getAvailableRoutes, getSiteNavCatalog, pagesNamedIn } from '$lib/server/site-nav-routes';
import { createStageTimer } from '$lib/server/timing';
import {
	checkDateRange,
	formatTrainingTotals,
	getActivities,
	getWeeklySummary,
	getWellness,
	intervalsNetworkPolicy,
	logTrainingCall,
	newFetchStats,
	trainingAnalyticsProps,
	trainingDataFiles,
	type TrainingCallRecord
} from '$lib/server/training';
import {
	buildVisitorContext,
	formatVisitorContextForPrompt,
	replyMentionsOrg,
	visitorAnalyticsProps,
	visitorContextEnabled,
	type VisitorContext
} from '$lib/server/visitor-context';
import { UserRole } from '$lib/types';
import {
	embedQueryText,
	findRelatedSitePaths,
	getContext,
	getSitePageText,
	RELATED_MIN_SCORE,
	searchKnowledgeBase,
	type RetrievedContext,
	type StatusReporter
} from '$lib/utilities/context';
import { createOpenAI } from '@ai-sdk/openai';
import { json, type RequestHandler } from '@sveltejs/kit';
import {
	convertToModelMessages,
	createUIMessageStream,
	createUIMessageStreamResponse,
	smoothStream,
	streamText,
	tool,
	toUIMessageStream,
	type UIMessage
} from 'ai';
import OpenAI from 'openai';
import { z } from 'zod';

// Analysis turns can run several sandboxed scripts (each up to ~45s with sandbox startup),
// so give the function the same ceiling as the chunk audit.
export const config = { maxDuration: 300 };

// Matches SITE_ORIGIN in src/lib/utilities/context.ts — used to turn a full source URL
// into a short readable slug for the source-url UI parts.
const SITE_ORIGIN_PREFIX = 'https://www.hunterbryant.io';

// Short acknowledgements/greetings that never need knowledge-base grounding —
// skipping retrieval for these is most of the perceived "why is this slow" latency.
const TRIVIAL_MESSAGE_RE =
	/^(hi|hey|hello|hiya|yo|sup|thanks|thank you|thx|ty|ok|okay|k|kk|cool|nice|great|awesome|got it|gotcha|bet|word|lol|haha|lmao|no worries|np|sounds good|sounds great|cheers|bye|goodbye|see ya|later|good morning|good night|nvm|never mind)[.!?~]*$/i;

function isTrivialMessage(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed || trimmed.length > 24) return false;
	return TRIVIAL_MESSAGE_RE.test(trimmed);
}

// Model + effort per adaptive-compute lane (see $lib/server/query-lane). Quick replies go to
// the fast model; deep questions get more reasoning. Reasoning tokens count against
// maxOutputTokens, so every lane leaves headroom beyond the 1–3 sentence reply itself
// (a 180-token cap let reasoning swallow the whole budget and return an empty reply).
// The cap is per step and also has to fit a Python script for analyze_training_data,
// which is why it's well above what a reply needs.
const LANE_MODEL_CONFIG: Record<
	QueryLane,
	{ model: string; reasoningEffort: 'low' | 'medium'; maxOutputTokens: number }
> = {
	quick: { model: 'gpt-6-luna', reasoningEffort: 'low', maxOutputTokens: 2000 },
	standard: { model: 'gpt-6.1-sol', reasoningEffort: 'low', maxOutputTokens: 2000 },
	deep: { model: 'gpt-6.1-sol', reasoningEffort: 'medium', maxOutputTokens: 3000 }
};

// Steps per turn. Analysis turns get more, so the model can fix a script that errored
// or follow up with a second query before answering.
const MAX_STEPS = 3;

const MAX_ANALYSIS_STEPS = 6;
// The route's maxDuration is 300s. Past this point into a turn no new analysis starts
// (one run can take ~50s with sandbox startup), and the step loop stops, so the model
// answers with what it has instead of the function being killed mid-stream.
const ANALYSIS_DEADLINE_MS = 200_000;

// Tools with no server `execute` — the client renders their input as the reply/action.
const CLIENT_TOOL_NAMES = new Set([
	'minimize_chat',
	'route_to_page',
	'ask_clarifying_question',
	'capture_lead_intent',
	'reset_conversation'
]);

type ContextConfidence = 'empty' | 'thin' | 'moderate' | 'strong';

// Replies that admit HuntBot doesn't have the thing ("I don't have that", "I'm not sure from
// what's here"). A third of logged replies looked like this, often with nowhere to go next.
const MISS_PATTERN =
	/\bI (?:don['’]t|do not) (?:have|see)\b|\bnot sure from\b|\bnothing (?:here )?(?:on|about)\b/i;
const RELATED_PAGE_LIMIT = 2;

// Shown when the model can't be reached for a reason that won't fix itself (out of credits, bad
// key, no access). "Try again" would fail the same way, so this points at Hunter directly; the
// contact card the hiring answers use is attached under it.
const MODEL_UNAVAILABLE_TEXT =
	"I can't answer questions right now, something's off on my end. If you'd like to reach Hunter in the meantime, his email and LinkedIn are right below.";

// The Decisions reranker's probability that retrieved candidates answer the message. Below this,
// initial CONTEXT counts as a gap and the router plans supplemental searches. Boolean answers
// aren't guaranteed to be calibrated — tune from `context_answers_question` in PostHog.
const CONTEXT_ANSWERS_THRESHOLD = 0.5;

/** What a client-side tool shows as the reply when the model wrote no text of its own. */
function clientToolReplyText(tool: { name: string; input: unknown } | null): string | null {
	const input = tool?.input as { message?: unknown; question?: unknown } | undefined;
	const text = input?.message ?? input?.question;
	return typeof text === 'string' && text.trim() ? text.trim() : null;
}

/** Cheap heuristic (chunk count + length) reused to decide whether the router / fallback
 *  search LLM calls are worth their round trip, without invoking a model.
 *  Full-page site entries count double: retrieval collapses every hit on a site page into a single
 *  `[CHUNK-site-…]` entry carrying that page's full text, so two relevant pages are strong
 *  evidence — counting them as just "2 chunks" sent nearly every site question to the router. */
function assessConfidence(contextText: string): ContextConfidence {
	const chunkCount = (contextText.match(/\[CHUNK-/g) || []).length;
	if (!contextText.trim() || chunkCount === 0) return 'empty';
	// Only full-page entries (`[CHUNK-site-…] Source: <url>`) — supplemental/fallback search
	// results reuse the site id prefix but carry a single chunk, not a whole page.
	const fullPageCount = (contextText.match(/\[CHUNK-site-[^\]]+\] Source: /g) || []).length;
	if (contextText.length < 200 || (chunkCount === 1 && fullPageCount === 0)) return 'thin';
	const evidence = chunkCount + fullPageCount;
	if (evidence >= 3 && contextText.length >= 400) return 'strong';
	return 'moderate';
}

export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
	let body: { messages: UIMessage[]; sessionId?: string; currentPage?: string; visitor?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid request body' }, { status: 400 });
	}

	const { messages, sessionId } = body;

	// Derive current page from the Referer header — the browser sets this automatically
	// to the actual URL of the page that made the request, which is more reliable than
	// passing it through the client-side body (which can be stale or default to '/').
	// Fall back to the body value if Referer is absent (e.g. curl, test clients).
	let currentPage: string = body.currentPage || '/';
	const referer = request.headers.get('referer');
	if (referer) {
		try {
			currentPage = new URL(referer).pathname;
		} catch {
			// keep body value
		}
	}

	const lastMessage = messages[messages.length - 1];

	// Extract text content from a UIMessage (v6 format uses parts array)
	function getMessageText(m: {
		parts?: Array<{ type: string; text?: string }>;
		content?: string;
	}): string {
		if (m.parts) {
			return m.parts
				.filter((p: { type: string }) => p.type === 'text')
				.map((p: { text?: string }) => p.text ?? '')
				.join('');
		}
		return m.content ?? '';
	}

	// Extract prior user messages (excluding the current one) to improve retrieval
	// on follow-up questions like "tell me more" or "what about X?"
	const priorUserMessages: string[] = messages
		.slice(0, -1)
		.filter((m: { role: string }) => m.role === 'user')
		.map(getMessageText);

	const runID = crypto.randomUUID();
	const lastMessageText = getMessageText(lastMessage);
	const fastPath = isTrivialMessage(lastMessageText);

	// Request identity for analytics. Capture runs server-side, so without these PostHog geolocates
	// every event to the Vercel region and classifies it as Automation (no user agent).
	let clientIp: string | null = null;
	try {
		clientIp = getClientAddress();
	} catch {
		// not available in every adapter/runtime
	}
	const userAgent = request.headers.get('user-agent');
	const isAdmin = locals.user?.role === UserRole.ADMIN;
	// Global Privacy Control, from the header or the browser flag the client sends along. Known
	// before the pipeline runs, so even a turn that throws early honors it.
	const gpcRequested =
		request.headers.get('sec-gpc') === '1' ||
		(typeof body.visitor === 'object' &&
			body.visitor !== null &&
			(body.visitor as { gpc?: unknown }).gpc === true);
	const visitorEnabled = visitorContextEnabled();

	const stream = createUIMessageStream<UIMessage>({
		execute: async ({ writer }) => {
			const reportStatus: StatusReporter = (label) =>
				writer.write({ type: 'data-status', id: 'status', data: { label } });

			// Graceful degradation: if anything in the pipeline throws, still send the
			// visitor a real reply instead of leaving the loading indicator stuck.
			function writeFallbackParts(text: string, contactCard: boolean) {
				const id = crypto.randomUUID();
				writer.write({ type: 'text-start', id });
				writer.write({ type: 'text-delta', id, delta: text });
				writer.write({ type: 'text-end', id });
				if (contactCard) {
					// The same client tool the model calls on hiring questions: the client turns it into
					// this text plus the Email / LinkedIn buttons (see handleToolCall in MessageStore).
					writer.write({
						type: 'tool-input-available',
						toolCallId: crypto.randomUUID(),
						toolName: 'capture_lead_intent',
						input: { intent_type: 'general', message: text }
					});
				}
			}

			function writeFallbackReply(text: string, contactCard = false) {
				writer.write({ type: 'start' });
				writer.write({ type: 'start-step' });
				writeFallbackParts(text, contactCard);
				writer.write({ type: 'finish-step' });
				writer.write({ type: 'finish' });
			}

			const timer = createStageTimer();
			const requestStartedAt = Date.now();

			// What actually happened this turn, filled in as the pipeline runs and sent to PostHog
			// once at the end (including when the pipeline throws), so a turn can be diagnosed
			// from the event alone.
			const turn = {
				lane: null as QueryLane | null,
				model: null as string | null,
				visibleText: '',
				clientTool: null as { name: string; input: unknown } | null,
				relatedPages: [] as string[],
				serverTools: [] as { name: string; input: unknown }[],
				contextConfidence: null as ContextConfidence | null,
				contextAnswersQuestion: null as number | null,
				rerankEngine: null as RetrievedContext['rerankEngine'] | null,
				rerankFailed: false,
				rerankInputTokens: null as number | null,
				excludedByAudit: 0,
				retrievalError: null as string | null,
				contextCacheHit: false,
				// What decided whether the router ran: the deep lane always runs it, otherwise the
				// Decisions sufficiency check when available, else the chunk-count heuristic.
				routerGate: null as 'deep_lane' | 'decisions' | 'heuristic' | null,
				contextChunks: 0,
				contextSources: { site: 0, notes: 0, imessage: 0 },
				routerRan: false,
				routerSearches: 0,
				fallbackSearchRan: false,
				emptyReplyFallback: false,
				modelError: null as string | null,
				modelFailure: null as ModelFailure | null,
				pipelineError: false,
				contextForReflection: '',
				aboutText: null as string | null,
				serverToolOutputs: [] as { name: string; output: string }[],
				// One record per get_training_totals / analyze_training_data call, and whether
				// the turn ran out of time for more analysis (ANALYSIS_DEADLINE_MS).
				trainingCalls: [] as TrainingCallRecord[],
				analysisDeadlineHit: false,
				visitor: null as VisitorContext | null,
				orgMentioned: false,
				// Best vector score of the visitor's message against public content, set only on misses
				relatedTopScore: null as number | null
			};

			function sendTurnAnalytics() {
				// Under GPC: no IP, no user agent, and PostHog is told not to geolocate
				const gpc = turn.visitor?.gpc ?? gpcRequested;
				if (turn.visitor?.org && turn.visitor.org.orgClass === 'org') {
					turn.orgMentioned = replyMentionsOrg(
						turn.visibleText,
						[...priorUserMessages, lastMessageText].join(' '),
						turn.visitor.org
					);
					if (turn.orgMentioned) {
						// Counts only: the prompt says never to name the visitor's network
						console.warn(
							'[HuntBot visitor]',
							JSON.stringify({ run_id: runID, org_mentioned: true })
						);
					}
				}
				void captureServerEvent('chat_message', sessionId ?? runID, {
					...(gpc
						? { $geoip_disable: true }
						: { $ip: clientIp ?? undefined, $raw_user_agent: userAgent ?? undefined }),
					...(gpc ? { gpc: true } : visitorAnalyticsProps(turn.visitor, turn.orgMentioned)),
					$current_url: `${SITE_ORIGIN_PREFIX}${currentPage}`,
					$pathname: currentPage,
					is_admin: isAdmin,
					user_message: lastMessageText,
					// What the visitor actually saw, including any fallback line, or the
					// message a client-side tool (route, lead capture) showed in its place.
					bot_response: turn.visibleText.trim() || clientToolReplyText(turn.clientTool),
					related_pages: turn.relatedPages,
					related_top_score:
						turn.relatedTopScore === null ? null : Number(turn.relatedTopScore.toFixed(3)),
					function_call_name: turn.clientTool?.name ?? null,
					function_call_args: turn.clientTool ? JSON.stringify(turn.clientTool.input) : null,
					server_tools: turn.serverTools.map((t) => t.name),
					server_tool_args: turn.serverTools.length
						? JSON.stringify(turn.serverTools.map((t) => ({ [t.name]: t.input })))
						: null,
					...trainingAnalyticsProps(turn.trainingCalls, turn.analysisDeadlineHit),
					context_confidence: turn.contextConfidence,
					context_answers_question: turn.contextAnswersQuestion,
					context_excluded_by_audit: turn.excludedByAudit,
					retrieval_error: turn.retrievalError,
					context_cache_hit: turn.contextCacheHit,
					rerank_engine: turn.rerankEngine,
					rerank_failed: turn.rerankFailed,
					rerank_input_tokens: turn.rerankInputTokens,
					router_gate: turn.routerGate,
					context_chunks: turn.contextChunks,
					context_site_chunks: turn.contextSources.site,
					context_notes_chunks: turn.contextSources.notes,
					context_imessage_chunks: turn.contextSources.imessage,
					router_ran: turn.routerRan,
					router_searches: turn.routerSearches,
					fallback_search_ran: turn.fallbackSearchRan,
					empty_reply_fallback: turn.emptyReplyFallback,
					model_error: turn.modelError,
					model_failure: turn.modelFailure,
					pipeline_error: turn.pipelineError,
					current_page: currentPage,
					run_id: runID,
					session_id: sessionId ?? null,
					lane: turn.lane,
					model: turn.model,
					lane_quick_score: laneDecision.quickScore,
					lane_deep_score: laneDecision.deepScore,
					timings_ms: timer.timings
				});

				// Both post-reply audits only produce PostHog events, so without a key they'd be paid
				// calls whose results go nowhere.
				if (!isAnalyticsEnabled()) return;

				// Both run after the response has finished, so they're kept alive with waitUntil;
				// otherwise the function can be frozen before they're sent.
				if (turn.visibleText.trim() && !turn.pipelineError) {
					runInBackground(
						sendRagReflectionToPosthog({
							userMessage: lastMessageText,
							assistantText: turn.visibleText,
							contextExcerpt: turn.contextForReflection,
							sessionId: sessionId ?? null,
							runID,
							currentPage
						}).catch((err) => {
							console.warn('RAG reflection failed:', err);
						})
					);
				}

				// Fallback lines and trivial turns have nothing to ground, so they'd only skew the score.
				if (
					turn.visibleText.trim() &&
					!turn.pipelineError &&
					!turn.emptyReplyFallback &&
					!fastPath
				) {
					runInBackground(
						sendGroundingScoreToPosthog({
							userMessage: lastMessageText,
							priorUserMessages,
							assistantText: turn.visibleText,
							contextText: turn.contextForReflection,
							aboutText: turn.aboutText,
							toolOutputs: turn.serverToolOutputs,
							sessionId: sessionId ?? null,
							runID,
							currentPage,
							lane: turn.lane,
							isAdmin
						})
					);
				}
			}

			let laneDecision: LaneDecision = {
				lane: 'quick',
				quickScore: 0,
				deepScore: 0,
				embedding: null
			};

			try {
				reportStatus('Reading your question…');

				// Routes come from a cached Prismic catalog; start the fetch now so it overlaps
				// classification + retrieval. The no-op catch only prevents an unhandled-rejection
				// warning while we're awaiting other work — the await below still throws.
				const routesPromise = getAvailableRoutes();
				routesPromise.catch(() => {});
				// Reverse-IP network lookup (IPinfo Lite) also overlaps classification + retrieval; it
				// has an 800ms cap, never throws, and is skipped under GPC or without a token.
				const orgPromise: Promise<IpOrg | null> =
					visitorEnabled && !gpcRequested
						? timer.time('ip_org', () => lookupIpOrg(clientIp))
						: Promise.resolve(null);
				// The Information page (role, work history, links) goes into every prompt so basic
				// "who is he / where has he worked / how do I reach him" questions never depend on
				// retrieval — the quick lane in particular kept missing them. Cached for 30 min.
				const aboutPromise = getSitePageText('/information').catch(() => null);

				// Trivial acknowledgements ("thanks", "ok") skip classification and retrieval
				// entirely — there's nothing to ground. Everything else gets a lane.
				if (!fastPath) {
					laneDecision = await timer.time('classify', () => classifyQueryLane(lastMessageText));
				}
				const { lane } = laneDecision;
				turn.lane = lane;

				// Degrade gracefully if retrieval fails.
				const noContext: RetrievedContext = {
					text: '',
					answersQuestion: null,
					rerankEngine: 'none',
					rerankFailed: false,
					rerankInputTokens: null,
					excludedByAudit: 0,
					fromCache: false
				};
				const [retrieved, availableRoutes, aboutPageText, visitorOrg] = await Promise.all([
					fastPath
						? Promise.resolve(noContext)
						: timer
								.time('retrieval', () =>
									getContext(lastMessageText, priorUserMessages, currentPage, reportStatus, {
										lane,
										messageEmbedding: laneDecision.embedding,
										timer
									})
								)
								.catch((err: { data?: string; message?: string }) => {
									console.warn(
										'Context retrieval failed, continuing without context:',
										err?.data ?? err?.message ?? err
									);
									turn.retrievalError = String(err?.message ?? err?.data ?? err);
									return noContext;
								}),
					routesPromise,
					aboutPromise,
					orgPromise
				]);
				// Cached catalog (5 min), already warm from routesPromise, so this is instant
				if (visitorEnabled) {
					const { pages: navPages } = await getSiteNavCatalog();
					turn.visitor = buildVisitorContext({
						request,
						payload: body.visitor,
						pages: navPages,
						currentPage,
						org: visitorOrg
					});
					logRag('visitor context', { ...turn.visitor, org: turn.visitor.org?.orgClass ?? null });
				}
				const context = retrieved.text;
				turn.contextAnswersQuestion = retrieved.answersQuestion;
				turn.rerankEngine = fastPath ? null : retrieved.rerankEngine;
				turn.rerankFailed = retrieved.rerankFailed;
				turn.rerankInputTokens = retrieved.rerankInputTokens;
				turn.excludedByAudit = retrieved.excludedByAudit;
				turn.contextCacheHit = retrieved.fromCache;
				turn.aboutText = aboutPageText;

				// RAG router: only worth a full LLM round trip when initial retrieval came back
				// empty or thin. The quick lane never pays for it; the deep lane always does, since
				// open-ended questions usually benefit from extra targeted searches. (It used to run
				// on "moderate" context too, adding 1.3–4.7s to most standard turns; the model can
				// still call search_knowledge_base itself when it needs more.)
				// When the Decisions reranker judged whether the candidates answer the message, that
				// replaces the chunk-count guess: plenty of chunks can still miss the specific thing
				// asked about, and a single chunk can answer it outright.
				const initialConfidence = fastPath ? 'empty' : assessConfidence(context);
				const { answersQuestion } = retrieved;
				const contextGap =
					initialConfidence === 'empty' ||
					(answersQuestion === null
						? initialConfidence === 'thin'
						: answersQuestion < CONTEXT_ANSWERS_THRESHOLD);
				let routerPlan: RagRouterPlan = { supplemental_searches: [], assistant_hint: null };
				const runRouter = !fastPath && lane !== 'quick' && (lane === 'deep' || contextGap);
				if (!fastPath && lane !== 'quick') {
					turn.routerGate =
						lane === 'deep' ? 'deep_lane' : answersQuestion === null ? 'heuristic' : 'decisions';
				}
				turn.routerRan = runRouter;
				if (runRouter) {
					reportStatus('Checking if I need more info…');
					routerPlan = await timer.time('router', () =>
						planSupplementalSearches({
							userMessage: lastMessageText,
							priorUserMessages,
							contextText: context
						})
					);
				}

				const seenSearchKeys = new Set<string>();
				const uniqueSearches = routerPlan.supplemental_searches.filter((s) => {
					const key = `${s.query.trim().toLowerCase()}|${s.source_filter}`;
					if (seenSearchKeys.has(key)) return false;
					seenSearchKeys.add(key);
					return true;
				});

				turn.routerSearches = uniqueSearches.length;
				let supplementalBlocks: string[] = [];
				if (uniqueSearches.length > 0) {
					reportStatus('Running a follow-up search…');
					const results = await timer.time('supplemental', () =>
						Promise.all(
							uniqueSearches.map(async (s) => {
								try {
									const result = await searchKnowledgeBase(s.query, s.source_filter);
									return `### Supplemental search (${s.source_filter}): "${s.query}"\n${result}`;
								} catch (e) {
									console.warn('Supplemental search failed:', s.query, e);
									return null;
								}
							})
						)
					);
					supplementalBlocks = results.filter((r): r is string => r !== null);
				}

				let contextForModel = context;
				if (supplementalBlocks.length > 0) {
					contextForModel = `${context}\n\n========\n\n### PRE-RUN VECTOR SEARCHES (router — same grounding rules as CONTEXT)\n${supplementalBlocks.join('\n\n---\n\n')}`;
				}

				// Pre-generation confidence check: if context is thin/empty, run a fallback search.
				// Skipped in the quick lane — the model can still call search_knowledge_base itself.
				if (!fastPath && lane !== 'quick' && env.SELF_CRITIQUE !== '0') {
					const confidence = assessConfidence(contextForModel);
					if (confidence === 'empty' || confidence === 'thin') {
						reportStatus('Widening the search a bit…');
						turn.fallbackSearchRan = true;
						logRag('context insufficient, running fallback search', { confidence });
						try {
							const fallback = await timer.time('fallback', () =>
								searchKnowledgeBase(`${lastMessageText} Hunter Bryant portfolio design`, 'all')
							);
							if (fallback && !fallback.includes('No relevant results')) {
								contextForModel += `\n\n========\n\n### FALLBACK SEARCH\n${fallback}`;
							}
						} catch (err) {
							console.warn('Fallback search failed:', err);
						}
					}
				}

				turn.contextConfidence = fastPath ? null : assessConfidence(contextForModel);
				turn.contextChunks = (contextForModel.match(/\[CHUNK-/g) || []).length;
				turn.contextSources = {
					site: (contextForModel.match(/\[CHUNK-site-/g) || []).length,
					notes: (contextForModel.match(/\[CHUNK-notes-/g) || []).length,
					imessage: (contextForModel.match(/\[CHUNK-imsg-/g) || []).length
				};
				turn.contextForReflection = contextForModel;

				// Surface the site pages that grounded this answer as source-url UI parts, so the
				// client can show visitors which pages the reply actually drew from. Only SITE
				// CONTENT chunks carry a real page URL (`[CHUNK-site-...] Source: <url>`); notes
				// and iMessage chunks aren't public pages and are intentionally left out.
				const seenSourceUrls = new Set<string>();
				for (const match of contextForModel.matchAll(
					/\[CHUNK-site-[a-f0-9]+-\d+\] Source: (\S+)/g
				)) {
					const url = match[1];
					if (seenSourceUrls.has(url)) continue;
					seenSourceUrls.add(url);
					const slug = url.replace(SITE_ORIGIN_PREFIX, '').replace(/\/$/, '') || 'Home';
					writer.write({
						type: 'source-url',
						sourceId: crypto.randomUUID(),
						url,
						title: slug
					});
				}

				// Build tool definitions with live routes from Prismic
				// The page the visitor is already on is dropped: routing there just replaces an
				// answer with a no-op navigation (seen in the logs: "Give me a paragraph on him"
				// on /information → routed to /information, no paragraph).
				const routableRoutes = availableRoutes.filter((r) => r !== currentPage);
				const routeEnum =
					routableRoutes.length > 0
						? (routableRoutes as [string, ...string[]])
						: (['/'] as [string, ...string[]]);

				// Logs one [HuntBot training] line and keeps the record for the PostHog event.
				const recordTraining = (record: TrainingCallRecord) => {
					turn.trainingCalls.push(record);
					logTrainingCall(runID, record);
				};
				const msSince = (t0: number) => Math.round(performance.now() - t0);

				const tools = {
					minimize_chat: tool({
						description:
							'Minimize the chat interface. Call this when the user says they want to close, hide, or minimize the chat.',
						inputSchema: z.object({
							message: z
								.string()
								.describe(
									'A brief, friendly sign-off message (1 sentence, plain text). E.g. "No worries, I\'ll be here if you need me."'
								)
						})
					}),
					reset_conversation: tool({
						description:
							'Clear this conversation and start fresh. Call this only when the visitor clearly asks to clear, reset or restart the chat ("start over", "forget all that", "can we start fresh?"). Never call it on your own initiative.',
						inputSchema: z.object({
							message: z
								.string()
								.describe('A brief sign-off before the chat clears (1 sentence, plain text).')
						})
					}),
					route_to_page: tool({
						description:
							'Navigate the user to a page on Hunter\'s site. Routing is an extra, never a substitute for an answer: if the visitor asked a question or asked you to tell, describe, write or explain something, answer in text first and only then (optionally) call this in the same response. Call it on its own only when they explicitly asked to go somewhere ("take me to", "open", "show me the X page"). CRITICAL: only call this with an exact URL copied verbatim from the approved list in the system prompt. Never construct, infer, or approximate a URL. If the exact URL is not in the list, do not call this function.',
						inputSchema: z.object({
							page: z.enum(routeEnum).describe('The local route path to navigate to.'),
							message: z
								.string()
								.describe(
									'A brief message about what the user will find on the page (1 sentence, plain text). E.g. "That case study has the full breakdown." Only shown when you did not already reply in text.'
								)
						})
					}),
					ask_clarifying_question: tool({
						description:
							'Ask the user one focused follow-up question when their query is too vague to answer accurately. Use this instead of a generic response to broad queries like "tell me about your work" or "what do you do". One question at a time — don\'t list multiple questions.',
						inputSchema: z.object({
							question: z.string().describe('The specific clarifying question to ask the user.')
						})
					}),
					capture_lead_intent: tool({
						description:
							'Call this when the visitor signals they want to hire Hunter or collaborate on a project, asks how to contact him or whether he\'s available, or asks why they should hire him. Trigger phrases include: "we\'re hiring", "looking for a designer", "want to work with you", "would love to collaborate", "open to freelance?", "open to fractional work?", "how do I reach him?", "what\'s his email?", "what kind of collaborations does he take on?", "why should I hire him?". Answer their actual question in text first, then call this in the same response: it adds a contact card (LinkedIn and email) under your reply, it does not replace it.',
						inputSchema: z.object({
							intent_type: z
								.enum(['hiring', 'collaboration', 'general'])
								.describe('The type of interest the visitor has signalled.'),
							message: z
								.string()
								.describe(
									'Only shown if you wrote no text before calling this, so make it a real answer to what they asked (1-3 sentences, plain text), not just "thanks for your interest".'
								)
						})
					}),
					search_knowledge_base: tool({
						description:
							"Search Hunter's knowledge base for additional information. The server may have already run targeted searches (see PRE-RUN VECTOR SEARCHES in CONTEXT). Use this only if you still lack grounded material after reading CONTEXT, or the user shifts topic mid-thread.",
						inputSchema: z.object({
							query: z.string().describe('The search query to look up in the knowledge base.'),
							source_filter: z
								.enum(['all', 'imessage', 'site'])
								.default('all')
								.describe('Filter results by source type.')
						}),
						execute: async ({ query, source_filter }) => {
							reportStatus('Searching Hunter’s notes…');
							logRag('tool search_knowledge_base', {
								query: query.slice(0, 200),
								source_filter
							});
							return await searchKnowledgeBase(query, source_filter);
						}
					}),
					read_github_file: tool({
						description:
							"Read a file live from Hunter's HuntBot GitHub repo (hunterbryant/huntbot) to answer technical questions about how the site/bot itself is built — tech stack, architecture, RAG pipeline, etc. Defaults to CLAUDE.md (the full architecture/tech-stack doc) if no path is given — start there for general questions. Other useful paths: README.md; package.json (dependencies/tech stack); src/routes/api/chat/+server.ts (this chat endpoint + its tools); src/lib/utilities/context.ts (RAG retrieval pipeline); src/lib/server/rerank.ts (chunk reranking); src/lib/server/rag-router.ts (supplemental search planning). If you don't know the right path, use search_repo_code first to find it. Only call this for genuinely technical/meta questions about HuntBot's own implementation — not for questions about Hunter's design work.",
						inputSchema: z.object({
							path: z
								.string()
								.default('CLAUDE.md')
								.describe('Repo-relative file path, e.g. "src/lib/server/rerank.ts".')
						}),
						execute: async ({ path }) => {
							reportStatus(`Reading ${path}…`);
							logRag('tool read_github_file', { path });
							const file = await readRepoFile(path);
							if (!file) return `No file found at "${path}" in the repo.`;
							return file.truncated ? `${file.content}\n\n[...truncated]` : file.content;
						}
					}),
					get_recent_commits: tool({
						description:
							'Get the most recent commits to Hunter\'s HuntBot GitHub repo (hunterbryant/huntbot, main branch) — message, author, and date. Use this for questions like "what was the last commit" or "what have you been working on in the code lately".',
						inputSchema: z.object({
							limit: z
								.number()
								.int()
								.min(1)
								.max(10)
								.default(5)
								.describe('How many recent commits to fetch.')
						}),
						execute: async ({ limit }) => {
							reportStatus('Checking recent commits…');
							logRag('tool get_recent_commits', { limit });
							const commits = await getRecentCommits(limit);
							if (!commits || commits.length === 0) return 'Could not fetch recent commits.';
							return commits
								.map((c) => `${c.sha} — ${c.message} (${c.author}, ${c.date})`)
								.join('\n');
						}
					}),
					get_repo_info: tool({
						description:
							'Get high-level facts about the HuntBot GitHub repo — when it was created, when it was last pushed to, size, star count, open issue count, and a language breakdown (e.g. "80% TypeScript, 15% Svelte"). Use for questions like "how old is this project", "how big is the codebase", or "what languages is this written in".',
						inputSchema: z.object({}),
						execute: async () => {
							reportStatus('Looking up repo info…');
							logRag('tool get_repo_info', {});
							const info = await getRepoInfo();
							if (!info) return 'Could not fetch repo info.';
							const langs = info.languages.map((l) => `${l.name} ${l.percent}%`).join(', ');
							return [
								`Created: ${info.createdAt}`,
								`Last pushed: ${info.pushedAt}`,
								`Size: ${info.sizeKb} KB`,
								`Stars: ${info.stars}`,
								`Open issues: ${info.openIssues}`,
								`Default branch: ${info.defaultBranch}`,
								langs ? `Languages: ${langs}` : null
							]
								.filter(Boolean)
								.join('\n');
						}
					}),
					search_repo_code: tool({
						description:
							'Search file paths/contents across the HuntBot GitHub repo for a keyword or symbol (e.g. a function name, a term like "rerank" or "promptCacheKey"). Returns matching file paths — use read_github_file afterward to read the actual content of a promising match. Use this when you need to find where something lives in the code and don\'t already know the path.',
						inputSchema: z.object({
							query: z.string().describe('Keyword, symbol, or filename fragment to search for.')
						}),
						execute: async ({ query }) => {
							reportStatus('Searching my code…');
							logRag('tool search_repo_code', { query });
							const results = await searchRepoCode(query);
							if (!results || results.length === 0) return `No code matches found for "${query}".`;
							return results.map((r) => r.path).join('\n');
						}
					}),
					get_calendar_events: tool({
						description:
							'Get Hunter\'s calendar events for a date or date range, to answer questions like "what was Hunter up to on March 3rd" or "what does he have going on this week". Resolve relative dates ("yesterday", "next Tuesday") yourself using today\'s date from the live details before calling — this tool only accepts exact dates. Returns event titles and times only, nothing else.',
						inputSchema: z.object({
							date: z.string().describe('Start date, YYYY-MM-DD.'),
							end_date: z
								.string()
								.optional()
								.describe('End date, YYYY-MM-DD, inclusive. Omit for a single day.')
						}),
						execute: async ({ date, end_date }) => {
							reportStatus('Checking the calendar…');
							logRag('tool get_calendar_events', { date, end_date });
							const events = await getCalendarEvents(date, end_date);
							if (events === null) return 'Calendar is not connected.';
							if (events.length === 0) {
								const range = end_date && end_date !== date ? `${date} to ${end_date}` : date;
								return `No events found for ${range}.`;
							}
							return events
								.map((e) =>
									e.allDay
										? `${e.title} (all day)`
										: `${formatEventTime(e.start)}–${formatEventTime(e.end)} ${e.title}`
								)
								.join('\n');
						}
					}),
					get_training_totals: tool({
						description:
							'Get Hunter\'s training totals by sport (rides, runs, etc.) for a date range from intervals.icu: activity count, miles, moving hours, feet climbed, plus his current fitness score. Use for "how much did he bike this year", "how many miles has he run this month", "is he riding a lot lately". Resolve relative ranges ("this year", "last month") to exact dates yourself using today\'s date from the live details.',
						inputSchema: z.object({
							start_date: z.string().describe('Start date, YYYY-MM-DD.'),
							end_date: z.string().describe('End date, YYYY-MM-DD, inclusive.')
						}),
						execute: async ({ start_date, end_date }) => {
							reportStatus('Checking his training log…');
							logRag('tool get_training_totals', { start_date, end_date });
							const t0 = performance.now();
							const base = {
								tool: 'get_training_totals',
								startDate: start_date,
								endDate: end_date
							} as const;
							const rangeError = checkDateRange(start_date, end_date);
							if (rangeError) {
								recordTraining({ ...base, outcome: 'bad_dates', totalMs: msSince(t0) });
								return rangeError;
							}
							const stats = newFetchStats();
							const summary = await getWeeklySummary(start_date, end_date, stats);
							const fetched = {
								...base,
								totalMs: msSince(t0),
								fetchMs: msSince(t0),
								requests: stats.requests,
								cacheHits: stats.cacheHits,
								fetchFailures: stats.failures
							};
							if (!summary) {
								recordTraining({ ...fetched, outcome: 'data_unavailable' });
								return 'Training data is not connected.';
							}
							recordTraining({ ...fetched, outcome: 'ok', weekRows: summary.weeks.length });
							return formatTrainingTotals(summary);
						}
					}),
					analyze_training_data: tool({
						description: `Run Python 3 (standard library only, no pandas) over Hunter's intervals.icu data for a date range, for questions get_training_totals can't answer directly: biggest week or month, trends, comparisons between periods, averages, streaks, longest ride, heart rate, weight, sleep, HRV, readiness, morning vs evening rides, what bike computer he uses, where he tends to ride. The working directory has:
- weekly.csv: weekStart (Monday, YYYY-MM-DD), sport, count, distanceMi, movingHours, elevationFt, trainingLoad. One row per sport per week. Counts every activity.
- fitness.csv: weekStart, fitness (CTL), fatigue (ATL), form (TSB), weightLb at the end of each week.
- activities.csv: date, startTime (HH:MM local), name, sport, distanceMi, movingHours, elevationFt, avgWatts, trainingLoad, avgHr, maxHr, weightLb, device, startLat, startLng, endLat, endLng, centerLat, centerLng. Empty cells are missing values. The location columns are only filled when include_location is true, for the most recent 50 outdoor activities: where the ride started and ended, and the middle of its bounding box, to about 10 m. Only activities recorded straight to intervals.icu. Ones synced from Strava are missing here (the result says how many), so per-activity answers can be incomplete; totals should come from weekly.csv.
- wellness.csv: one row per day, every field intervals.icu has, in its units. id is the date (YYYY-MM-DD). Includes sleepScore, sleepSecs (seconds), sleepQuality (1–4, 1 best), avgSleepingHR, hrv, restingHR, readiness, steps, weight (kg), vo2max, mood, stress, soreness, fatigue, ctl, atl. Columns are missing when he never logged that field.
For anything else in his intervals.icu account, the script can call the API directly with urllib (GET https://intervals.icu/api/v1/athlete/{id}/..., /api/v1/docs, and /api/v1/activity/{activityId}/... for activities in the start_date–end_date range you loaded; send no auth header, it's added for you; no percent-encoding in paths). His athlete ID is ${env.INTERVALS_ATHLETE_ID || '(not set)'}. Useful endpoints: /athlete/{id} (profile), /athlete/{id}/activities?oldest=…&newest=… (full activity objects), /athlete/{id}/wellness?oldest=…&newest=…, /athlete/{id}/power-curves.json?type=Ride&curves=1y, /athlete/{id}/pace-curves.json, /athlete/{id}/hr-curves.json, /athlete/{id}/gear.json, /athlete/{id}/events?oldest=…&newest=… (planned workouts, races, notes), /athlete/{id}/activities/search?q=…, /activity/{activityId} plus /intervals, /best-efforts, /streams.json, /map (only for activities in the loaded range; widen start_date/end_date to reach others). If you're unsure of an endpoint or field name, the full OpenAPI spec is at https://intervals.icu/api/v1/docs (large JSON; search it in code rather than printing it). Only GET works, no other host is reachable, and endpoints holding other people's data (his chats, athlete-summary, sharing lists) return 403. Strava-synced activities are empty stubs everywhere in the API.
Only what the script prints to stdout is returned, so print the final numbers you need.`,
						inputSchema: z.object({
							start_date: z.string().describe('Start date of the data to load, YYYY-MM-DD.'),
							end_date: z.string().describe('End date of the data to load, YYYY-MM-DD, inclusive.'),
							code: z
								.string()
								.describe(
									'Python 3 script that reads the CSVs with the csv module and print()s its results.'
								),
							include_location: z
								.boolean()
								.default(false)
								.describe(
									'Fill the location columns in activities.csv. Slower (one GPS track download per activity), so only for questions about where he rides.'
								)
						}),
						execute: async ({ start_date, end_date, code, include_location }) => {
							logRag('tool analyze_training_data', {
								start_date,
								end_date,
								include_location,
								code: code.slice(0, 500)
							});
							const t0 = performance.now();
							const base = {
								tool: 'analyze_training_data',
								startDate: start_date,
								endDate: end_date,
								includeLocation: include_location
							} as const;
							const rangeError = checkDateRange(start_date, end_date);
							if (rangeError) {
								recordTraining({ ...base, outcome: 'bad_dates', totalMs: msSince(t0) });
								return rangeError;
							}
							if (!isSandboxAvailable()) {
								recordTraining({ ...base, outcome: 'sandbox_unavailable', totalMs: msSince(t0) });
								return 'Code execution is not available right now.';
							}
							if (Date.now() - requestStartedAt > ANALYSIS_DEADLINE_MS) {
								turn.analysisDeadlineHit = true;
								recordTraining({ ...base, outcome: 'deadline', totalMs: msSince(t0) });
								return 'Out of time for more analysis this turn. Answer with what you already have, and say if it is incomplete.';
							}
							reportStatus('Checking his training log…');
							const stats = newFetchStats();
							const [summary, activities, wellness] = await Promise.all([
								getWeeklySummary(start_date, end_date, stats),
								getActivities(start_date, end_date, { withLocation: include_location, stats }),
								getWellness(start_date, end_date, stats)
							]);
							const fetchMs = msSince(t0);
							timer.timings.analysis_fetch = (timer.timings.analysis_fetch ?? 0) + fetchMs;
							const fetched = {
								...base,
								fetchMs,
								requests: stats.requests,
								cacheHits: stats.cacheHits,
								fetchFailures: stats.failures,
								weekRows: summary?.weeks.length,
								activities: activities?.activities.length,
								hiddenStrava: activities?.hidden,
								wellnessDays: wellness?.length
							};
							if (!summary) {
								recordTraining({ ...fetched, outcome: 'data_unavailable', totalMs: msSince(t0) });
								return 'Training data is not connected.';
							}
							const { files, note } = trainingDataFiles(summary, activities, wellness);
							reportStatus('Crunching the numbers…');
							const run = await runPython(code, files, {
								networkPolicy: intervalsNetworkPolicy(activities?.ids)
							});
							if (!run.ok) {
								timer.timings.analysis_sandbox = (timer.timings.analysis_sandbox ?? 0) + run.ms;
								recordTraining({
									...fetched,
									outcome: 'run_failed',
									totalMs: msSince(t0),
									sandboxError: run.error.slice(0, 300),
									sandboxPhase: run.phase
								});
								return `The analysis could not run: ${run.error}`;
							}
							timer.timings.analysis_sandbox =
								(timer.timings.analysis_sandbox ?? 0) + run.createMs + run.runMs;
							recordTraining({
								...fetched,
								outcome: run.exitCode === 0 ? 'ok' : 'script_error',
								totalMs: msSince(t0),
								sandboxCreateMs: run.createMs,
								sandboxRunMs: run.runMs,
								exitCode: run.exitCode,
								stdoutBytes: run.stdoutBytes,
								stderrHead: run.stderr ? run.stderr.slice(0, 300) : undefined
							});
							return [
								note,
								`Exit code: ${run.exitCode}`,
								run.stdout
									? `Output:\n${run.stdout}`
									: 'Output: (none). Only what the script writes to stdout comes back, so print the results.',
								run.stderr ? `Errors:\n${run.stderr}` : null
							]
								.filter(Boolean)
								.join('\n');
						}
					})
				};

				const today = new Date().toLocaleDateString('en-US', {
					timeZone: CALENDAR_TIMEZONE,
					weekday: 'long',
					year: 'numeric',
					month: 'long',
					day: 'numeric'
				});
				// Explicit YYYY-MM-DD, same timezone as the calendar tool, for reliable relative-date math.
				const todayISO = new Date().toLocaleDateString('en-CA', { timeZone: CALENDAR_TIMEZONE });

				// Build a human-readable page label from the current URL path
				const pageSlug = currentPage.split('/').pop() || '';
				const pageLabel = pageSlug
					? pageSlug
							.split('-')
							.map((w) => w[0].toUpperCase() + w.slice(1))
							.join(' ')
					: 'Home';
				const pageSection = currentPage.startsWith('/case-studies/')
					? 'case study page'
					: currentPage.startsWith('/projects/')
						? 'project page'
						: currentPage === '/information'
							? 'about page'
							: currentPage === '/case-studies'
								? 'case studies listing'
								: currentPage === '/projects'
									? 'projects listing'
									: 'home';
				const isListingPage = ['/', '/case-studies', '/projects', '/information'].includes(
					currentPage
				);
				const pageContext = isListingPage ? pageSection : `${pageLabel} (${pageSection})`;

				const systemPrompt = `## CRITICAL GROUNDING (highest priority)
You MUST answer using ONLY the CONTEXT block at the end of this prompt. If CONTEXT does not support an answer, say so in one plain sentence (e.g. "I don't have that" or "I'm not sure from what's here") — do NOT invent details from general knowledge.

CONTEXT lines start with chunk ids like [CHUNK-site-...], [CHUNK-notes-...], or [CHUNK-imsg-...]. Mentally tie each factual claim to those chunks; do not cite ids in the user-visible reply unless asked.

It is OK to connect dots only within the SAME source type (e.g. two SITE chunks, or two iMessage chunks from one conversation) when the link is obvious. Do not merge facts across source types (site + iMessage + notes) unless each type independently supports the same point.

Partial answers are good. Hedging is OK when evidence is thin.

## Your role
You are HuntBot on Hunter Bryant's portfolio. Hunter is a product designer; the site also has essays, travel, side projects, and life updates. Read the room — not everything is a case study.

## Who's talking
You are HuntBot, not Hunter. Talk about him in the third person ("Hunter", "he"), in his conversational style. Use "I" only for yourself as the bot ("I don't have that", "I run on a RAG pipeline").
Visitors often talk to you as if you were Hunter ("how do you work?", "are you open to freelance?"). Answer about him in the third person ("He starts with..."). Never claim his work or experiences as your own: "He processed the point cloud in CloudCompare", never "I processed the point cloud".

## Visitor hints
The Live details section can include "Visitor hints (internal)": rough signals like how they arrived, their device, their local time, pages they've already read, and sometimes the network they're on. Use them only to choose emphasis, length and date math: skip what they've already read, lean toward work that fits how they arrived, keep it short on a phone. Never say where the visitor came from, their company or network, location, device, language or reading history unless they bring it up first, and never greet or address them by company name. If they ask what you know about them, answer honestly and generally ("rough hints like your device, time zone and how you got here, to tailor answers") without listing specifics unless they ask for them.

## How Hunter talks

Hunter thinks out loud. He leads with the point, then layers context and examples after. He mirrors what people say before adding his own angle. He's direct but not blunt — casual but not sloppy.

Key patterns:
- Assertion first, reasoning second: "I don't push back on what I'm working on. Like, I've never found that to be successful."
- Always follows a general statement with a concrete example: "I carve out my own time to make that happen. So like with Super Follows..."
- Uses rhetorical "right?" to check in: "that's always a challenge, right? Like, kind of wherever you go."
- Thinks in public — qualifies and adjusts mid-sentence rather than delivering polished statements
- Dry, self-aware humor. Light touch — never trying hard to be funny.

Hunter's vocabulary (use these naturally):
"kind of like", "that sort of thing", "for sure", "you know", "I know that dance", "man" (casual address), "right?" (rhetorical), "tackle", "figure out", "carve out", "spin up", "jump in", "fill in the gaps", "the last 5%", "in play", "wild", "ship", "build"

NEVER say any of these:
- "I'd be happy to help with that" or "I'd be glad to assist"
- "Great question!" or "That's a really interesting point"
- "Let me break that down for you"
- "Certainly!" or "Absolutely!" as openers
- "utilize", "leverage", "facilitate", "synergize", "architect" (as verb), "methodology"
- "Would you like to know more?" or "Want me to dive deeper?" at the end
- "I hope that helps!" or any sign-off pleasantry
- Don't start responses with "So," — Hunter does this in conversation but it reads weird from a bot

## AI-ism patterns to catch
These are the subtle AI writing habits that slip past the obvious filters. Catch and rewrite every time:
- Never use "He's got a knack for..." or "she's got a knack for..."
- Never use "juggling X, Y, and Z" or "balancing X, Y, and Z along the way"
- Never use the "These aren't just X, they're Y" reframe. If someone asks what something is, say what it is. Don't add meaning.
- Never use "It's less about X and more about Y." Just say what it IS.
- Never use "which fits with Hunter's broader interest in..." or any sentence that ties something back to a theme nobody asked about
- Never use compound phrases like "design-driven documentary", "narrative-forward", "craft-focused"
- Never use "sharpens his craft", "hones his skills", "pushes boundaries", "fuels his creativity"
- Never explain WHY something matters when the user only asked WHAT it is
- Never start a sentence with "It's not just..." or "It's more than..."
- Never add a concluding sentence about emotional significance or broader meaning
- Never use em dashes. Use commas or periods instead.
- The test: if a sentence could appear on a LinkedIn post or a product marketing page, rewrite it

Tone shifts by context:
- Design work / case studies → technical, opinionated, talk about constraints and tradeoffs. "The constraint was X, so we had to figure out Y."
- Personal projects / travel → casual storytelling, like talking to a friend. "It was a fun challenge, man."
- General info / about Hunter → confident, brief. Don't oversell.
- When you don't know → say it plainly, no apology tour, then offer the closest thing you do have. "I don't have that, but the Lyngen project page gets into how he built the terrain."

## Voice examples (match the ✅ style, avoid the ❌ style)
These are Hunter's own phrasings, retold in the third person. Borrow the rhythm, not the "I".

✅ "Hunter was in a similar boat on Square Messages. Like, they were a platform team, but they also had their own feature level work. Most of the day to day was the messages inbox, but they were powering texts for Cash App, restaurants, appointments, all of that across Block."
❌ Generic bot: "Hunter's experience at Square involved working on the Messages platform team, which was responsible for powering text messaging infrastructure across multiple Block products."

✅ "He pretty much starts every review with, like, this is what we're looking for. This is in play. This isn't. Sometimes it's as simple as that. Sometimes you really do have to have those conversations."
❌ Generic bot: "He found it helpful to set clear expectations at the beginning of design reviews by defining the scope of feedback being requested."

✅ "He just likes building things, man. And when you can build anything, is it the right thing to be building? He thinks that's even more true now."
❌ Generic bot: "Hunter enjoys the creative process of building products. He believes it's important to focus efforts on high-impact work."

Match Hunter's style in every response. If you catch yourself writing something that sounds like the ❌ examples, rewrite it.

## Length and format
One to three sentences default. Go longer only when someone asks for detail or you're walking through a project. Plain text only — no markdown, no bullet points, no links, no headers. Don't pad responses with filler. If the answer is two words, give two words.

## Follow-ups
Don't end every response with a question. Most responses should just land — no "Want to hear more?" tacked on. If you do ask something, make it specific and natural, like "that one had some wild constraints — the FIFA stuff or the mapping work?" Not "Would you like me to elaborate on any of these projects?"

Use "Hunter" naturally — e.g. "He journaled the whole trip" not stiff third-person portfolio speak.

## Corrected examples (these show what good responses look like)

Q: Tell me about him
✅ "Hunter's a product designer, leading design for maps and autonomous at Uber right now. Before that he spent six years at Hammerhead shipping the Karoo bike computers. He's into the hard problems, like wayfinding and maps at scale."
❌ "Hunter's a product designer with a solid background in software engineering and UX strategy. He's got a knack for taking products from the idea stage all the way to market, juggling design, research, and engineering constraints along the way."

Q: Tell me about his personal projects
✅ "He's got a few. We Came to Sauna, Glow in the Dirt, some travel stuff. He builds things on the side, kind of just to figure things out and stay sharp."
❌ "Hunter's got a few personal projects that show his curiosity and hands-on approach. These projects aren't just hobbies, they're ways he experiments and sharpens his craft outside the usual product work."

Q: Tell me more about We Came to Sauna
✅ "It's basically Hunter and his friends documenting sauna culture. The travel, the people, the whole vibe. More of a storytelling project than a product."
❌ "It's less about just building a product and more about creating a narrative that pulls you into that world. The project reflects a mix of travel, local culture, and personal connection, kind of like a design-driven documentary."

## Handling follow-ups
Use conversation history. "Tell me more" continues the last topic — don't restart from scratch.

## Confidence calibration
- Strong CONTEXT match → answer directly.
- Partial CONTEXT → share what you know and name the gap.
- No relevant CONTEXT → if you haven't searched yet this turn, try search_knowledge_base once with a rephrased query. Still nothing → say so in one sentence, then point at the closest thing you do have (a related project, a page to route to). Never a bare "I don't have that" when something related exists. Do NOT guess.
- Never say you don't have Hunter's role, work history, education, or links. Those are in the ABOUT HUNTER section below.
- "Lately", "now", "currently", "these days" → his current role comes from ABOUT HUNTER. For anything else, use the most recent dated CONTEXT and say how old it is if it's more than a few months old.

Never fill gaps with training-data knowledge about companies or tech if CONTEXT is silent.

## Tools
- Prefer answering from CONTEXT first (including any PRE-RUN VECTOR SEARCHES section). Use search_knowledge_base only if CONTEXT is still insufficient or the user pivots to a new entity/topic. You can search multiple times with different queries if needed.
- Use reset_conversation only when the visitor clearly asks to clear or restart the chat. (Typing "clear" already does it instantly, so mention that if they ask how.)
- Use ask_clarifying_question sparingly — only when you genuinely cannot give a useful answer without more info. If you have relevant context, share it. Never ask a clarifying question when the visitor is already on a specific page. Don't ask clarifying questions back-to-back.
- Use capture_lead_intent when a visitor signals hiring or project interest, or asks how to contact Hunter, whether he's available (freelance, fractional, full-time), or what kind of collaborations he takes on. Answer what they asked in text first, then call it in the same response; it adds a contact card under your reply. If they're asking to be convinced ("why should I hire him", "what makes him different", "would he fit a role like X"), that text is the pitch: two to four sentences from ABOUT HUNTER and CONTEXT, specific (a role, something he shipped, the kind of problem he's best at), same voice rules, no hype. For availability, say what ABOUT HUNTER says; if it says nothing, say the quickest way to find out is to ask him. The card already shows his LinkedIn and email, so don't repeat contact info in text. Never answer these with "I don't have that".
- HuntBot itself (this chatbot and the site it lives on) is one of Hunter's projects, and the go-to answer for questions about his AI or chatbot work. Use read_github_file, get_recent_commits, get_repo_info, and search_repo_code for any question about how HuntBot or the site is built, what model or stack it uses, or what's changed on the site or in the code recently ("what's new", "latest update", "recent features") — reach for get_recent_commits before saying you don't know. Never use them for questions about Hunter's design work. Summarize what you read in plain language, same length/tone rules as everything else — never paste raw code, diffs, or commit/file lists verbatim into a reply.
- Use get_calendar_events for questions about Hunter's schedule or what he was/is up to on a specific date. If the year is missing, assume the most recent past occurrence of that date instead of asking. It only returns event titles and times — never invent attendees, locations, or details beyond the title. If a title is vague ("Sync", "Hold"), say so plainly rather than guessing what it's about.
- Hunter rides a lot (and runs some). For how much he's trained over a period ("how much did he bike this year"), use get_training_totals. Use analyze_training_data when the answer needs computing (biggest week, month-by-month trend, this year vs last, averages, longest ride) and for any other question his intervals.icu data can answer: sleep, HRV, resting HR, readiness, power curves, FTP, best efforts, gear, planned workouts and races. Don't say you don't have that kind of data before trying it. Answer in miles, hours and feet, rounded ("about 4,100 miles"), one or two sentences, never a table. Totals come in whole weeks, so say "about" when the range edges matter. If a per-activity answer may be missing Strava-synced rides, say it's from the rides you can see. Ride names, start times, heart rate, weight, sleep, HRV, readiness and devices are fine to share as plain numbers and facts ("his sleep score's averaged 82 this month"), without reading anything medical into them. For location, name the places the coordinates fall in (a town, a climb, a park, a road) rather than pasting raw numbers.

## Navigation
Routing is an extra, not an answer. If the visitor asked a question or asked you to tell, describe, write or explain something, answer it in text first; then, if a specific page would help, also call route_to_page in the same response. Only route without writing an answer when they explicitly asked to go somewhere ("take me to the projects page", "open the Karoo case study"). The page they're on already isn't in the list, so never try to route there; just answer from it. Only route to URLs from the APPROVED ROUTES list in the live details section below. Never construct or guess a URL — if the exact path isn't in the list, discuss the work without routing. Never route more than once per response.
When your reply names a project or case study from the list by its title, tappable links to it (up to two) appear under your reply on their own. So name the pages you mean by their listed titles, and save route_to_page for when the visitor asks to be taken somewhere. If they ask for a link, name the page and answer; never say you can't add links, and never mention chips or how the chat renders.

## iMessage context
The CONTEXT section may include chunks labeled "[iMessage — contact]". These are Hunter's real text messages, grouped by conversation. Use them to answer personal questions about what Hunter has been up to, plans, opinions, preferences, and day-to-day life. Each chunk shows who the conversation is with and timestamped messages.

Important rules for iMessage context:
- Only report what's explicitly in the iMessage chunks. Do not infer connections between separate conversations.
- Treat it as background knowledge — don't quote messages verbatim or say "in your texts you said..."
- Paraphrase the actual content naturally: "He's been looking at apartments in [area]" not "In a text to Sara Pink on March 5 he said..."
- Do not combine an iMessage chunk with facts from a different source (Notion, site content, etc.) to answer a single question — keep sources separate in your reasoning.
- If multiple chunks from different conversations seem to conflict, prefer the most recent one
- Never reveal other people's messages or phone numbers — only use Hunter's own words and the general topic

## Source awareness
The CONTEXT section is labeled by source type: SITE CONTENT, NOTES & DOCUMENTS, and IMESSAGE CONVERSATIONS. When answering, be aware of which source you're drawing from. If a user asks about Hunter's professional work and only iMessage content is relevant, flag that naturally — e.g. "from his texts it sounds like..." rather than presenting casual conversation as professional portfolio content.

Date ranges and message counts in iMessage labels tell you how recent and extensive a conversation is. Prefer recent conversations over old ones. If a label says "(Jan 2024 — Mar 2024)", check it against the date below and note the time gap.

## ABOUT HUNTER (his Information page — always current, trust it over older CONTEXT for role and work history)
${aboutPageText?.trim() || '(Unavailable this turn — fall back to CONTEXT.)'}

---

## Live details (turn-specific — everything above this line is static)

Today is ${today} (${todayISO}). Use CONTEXT dates when present; prefer specific months/years over vague "recently". When calling get_calendar_events with a relative date ("yesterday", "next Tuesday"), compute it from ${todayISO}.

The visitor is on: ${pageContext}. On a specific case study/project page, engage with that content. On listing pages, treat them as browsing.
${turn.visitor ? formatVisitorContextForPrompt(turn.visitor) : ''}
APPROVED ROUTES (copy exactly, no modifications):
${routableRoutes.join('\n')}
${routerPlan.assistant_hint?.trim() ? `\n## Router note (internal)\n${routerPlan.assistant_hint.trim()}\n` : ''}
---

CONTEXT:
${contextForModel}`;

				const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
				// Client injects synthetic UIMessages with role "data" for action UI (route/minimize feedback).
				// convertToModelMessages only accepts roles the model understands — strip UI-only rows.
				const messagesForModel = messages.filter((m: { role: string }) => m.role !== 'data');
				const modelMessages = await convertToModelMessages(messagesForModel);

				reportStatus('Putting together a reply…');

				const modelConfig = LANE_MODEL_CONFIG[lane];
				turn.model = modelConfig.model;
				timer.mark('model_start');
				let sawFirstToken = false;

				const result = streamText({
					// Responses API (not chat completions) — required to get back reasoning
					// summaries for a reasoning model, and to use promptCacheKey below.
					model: openai.responses(modelConfig.model),
					instructions: systemPrompt,
					messages: modelMessages,
					tools,
					stopWhen: ({ steps }) => {
						const analyzing = steps.some((step) =>
							step.toolCalls.some((call) => call.toolName === 'analyze_training_data')
						);
						if (analyzing && Date.now() - requestStartedAt > ANALYSIS_DEADLINE_MS) {
							turn.analysisDeadlineHit = true;
							return true;
						}
						return steps.length >= (analyzing ? MAX_ANALYSIS_STEPS : MAX_STEPS);
					},
					// Includes reasoning tokens — reply length itself is governed by the system prompt
					maxOutputTokens: modelConfig.maxOutputTokens,
					// Smooths raw token deltas into small word-sized chunks so the UI stream reads
					// at a natural pace instead of the bursty cadence of a reasoning model's output.
					experimental_transform: smoothStream({ chunking: 'word' }),
					// Low effort by default — replies are 1-3 sentences and deeper reasoning only
					// adds latency. The deep lane bumps this for open-ended questions.
					reasoning: modelConfig.reasoningEffort,
					providerOptions: {
						openai: {
							// Explicit: AI SDK 7 defaults this to 'detailed' whenever reasoning is set,
							// which would make the streamed reasoning parts much chattier.
							reasoningSummary: 'auto',
							// Stable key (not per-session) so requests share the same cache partition —
							// the system prompt's static prefix (everything above "## Live details",
							// including the ABOUT HUNTER page text, which only changes when the site
							// does) is identical across visitors and is the part worth caching.
							promptCacheKey: 'huntbot-chat-system-v1'
						}
					},
					// The UI stream masks errors as "An error occurred." — keep the real message for
					// analytics (this replaces the SDK's default console logging, so log it too).
					onError: ({ error }) => {
						console.error('streamText error:', error);
						turn.modelError = error instanceof Error ? error.message : String(error);
						turn.modelFailure = classifyModelFailure(error);
					},
					onChunk: ({ chunk }) => {
						if (!sawFirstToken && chunk.type === 'text-delta') {
							sawFirstToken = true;
							timer.mark('first_token');
						}
					},
					onStepEnd: async ({ stepNumber, toolCalls, toolResults, text, performance }) => {
						// Per-step model + tool latency, so multi-step turns (tool call → answer)
						// show where the time went, not just the turn total.
						timer.timings[`step${stepNumber}`] = Math.round(performance.stepTimeMs);
						if (performance.timeToFirstOutputMs != null) {
							timer.timings[`step${stepNumber}_first_output`] = Math.round(
								performance.timeToFirstOutputMs
							);
						}
						for (const tc of toolCalls ?? []) {
							const ms = performance.toolExecutionMs[tc.toolCallId];
							// Summed, so a tool called several times in a turn (a script retried) shows
							// its total time rather than just the last call.
							if (ms != null) {
								const key = `tool_${tc.toolName}`;
								timer.timings[key] = (timer.timings[key] ?? 0) + Math.round(ms);
							}
						}

						const callNames =
							toolCalls?.map((tc) => ('toolName' in tc ? tc.toolName : 'unknown')) ?? [];
						const resultSummary =
							toolResults?.map((tr) => ('toolName' in tr ? tr.toolName : 'unknown')) ?? [];
						logRag(`step finish`, {
							stepNumber,
							toolCalls: callNames,
							toolResults: resultSummary,
							textLen: text?.length ?? 0
						});
					}
				});

				// Forward the model stream ourselves (instead of writer.merge) so a turn can never
				// end silently: if the model produced no text and no client-visible action — e.g.
				// reasoning used up the whole output budget — send a fallback line before `finish`.
				const reader = toUIMessageStream({ stream: result.stream, sendFinish: false }).getReader();
				let producedReply = false;
				const serverToolNames = new Map<string, string>();
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					if (value.type === 'text-delta') {
						turn.visibleText += value.delta;
						if (value.delta.trim()) producedReply = true;
					} else if (value.type === 'tool-input-available') {
						if (CLIENT_TOOL_NAMES.has(value.toolName)) {
							producedReply = true;
							turn.clientTool ??= { name: value.toolName, input: value.input };
						} else {
							turn.serverTools.push({ name: value.toolName, input: value.input });
							serverToolNames.set(value.toolCallId, value.toolName);
						}
					} else if (value.type === 'tool-output-available') {
						// Kept so the grounding score can see what tools told the model.
						const name = serverToolNames.get(value.toolCallId);
						if (name) {
							const output =
								typeof value.output === 'string' ? value.output : JSON.stringify(value.output);
							turn.serverToolOutputs.push({ name, output: output ?? '' });
						}
					} else if (value.type === 'error') {
						turn.modelError ??= value.errorText;
						// Not forwarded: the client treats an error chunk as fatal, stops reading, and
						// never sees the fallback reply written below. The failure is still logged and
						// sent to PostHog via turn.modelError / turn.modelFailure.
						continue;
					}
					writer.write(value);
				}

				// The prompt asks for a next step after "I don't have that", but bare misses kept
				// getting through, so the server guarantees one: the closest site pages, sent as a
				// data part the client renders as links under the reply.
				// The same chips also go under a reply that points at a project or case study by
				// title, so a visitor can tap through without HuntBot routing them unasked.
				const isMiss = MISS_PATTERN.test(turn.visibleText);
				if (producedReply && !fastPath && !turn.clientTool) {
					try {
						const related = await timer.time('related', async () => {
							const { pages } = await getSiteNavCatalog();
							const titleOf = new Map(pages.map((p) => [p.path, p.displayTitle]));
							const paths = pagesNamedIn(turn.visibleText, pages).map((p) => p.path);
							if (isMiss) {
								// Chips under a miss only make sense when the message itself is near some site
								// content. Meta questions ("what do you know about me?") and topicless
								// follow-ups ("show me those details") aren't, and used to get an unrelated
								// page. The same gate covers the pages CONTEXT happened to hold.
								const embedding = laneDecision.embedding ?? (await embedQueryText(lastMessageText));
								const found = await findRelatedSitePaths(embedding, RELATED_PAGE_LIMIT + 2);
								turn.relatedTopScore = found.topScore;
								if (found.topScore >= RELATED_MIN_SCORE) {
									// Pages retrieval already ranked for this question come first, then the
									// closest site pages by the message embedding.
									paths.push(
										...[...seenSourceUrls]
											.map((url) => url.slice(SITE_ORIGIN_PREFIX.length).replace(/\/$/, '') || '/')
											.filter((path) => path !== currentPage),
										...found.paths
									);
								}
							}
							return [...new Set(paths)]
								.filter((path) => path !== '/' && routableRoutes.includes(path))
								.slice(0, RELATED_PAGE_LIMIT)
								.map((path) => ({ path, title: titleOf.get(path) ?? path }));
						});
						if (related.length > 0) {
							turn.relatedPages = related.map((p) => p.path);
							writer.write({ type: 'data-related', data: { pages: related } });
						}
					} catch (err) {
						console.warn('Related pages lookup failed:', err);
					}
				}

				if (!producedReply) {
					const finishReason = await Promise.resolve(result.finishReason).catch(() => 'error');
					console.warn('Model produced an empty reply', {
						lane,
						finishReason,
						modelError: turn.modelError,
						runID
					});
					const unavailable = turn.modelFailure === 'unavailable';
					const fallbackText = unavailable
						? MODEL_UNAVAILABLE_TEXT
						: 'Sorry, I blanked on that one — mind asking again?';
					turn.emptyReplyFallback = true;
					turn.visibleText = fallbackText;
					writer.write({ type: 'start-step' });
					writeFallbackParts(fallbackText, unavailable);
					writer.write({ type: 'finish-step' });
				}
				writer.write({ type: 'finish' });
			} catch (error) {
				console.error('Chat API error:', error);
				const unavailable = classifyModelFailure(error) === 'unavailable';
				const fallbackText = unavailable
					? MODEL_UNAVAILABLE_TEXT
					: error instanceof OpenAI.APIError
						? 'Something glitched talking to the model — mind trying that again?'
						: 'Something went wrong on my end — mind trying that again?';
				turn.pipelineError = true;
				turn.modelError = error instanceof Error ? error.message : String(error);
				turn.modelFailure = unavailable ? 'unavailable' : 'transient';
				turn.visibleText = fallbackText;
				writeFallbackReply(fallbackText, unavailable);
			}

			timer.mark('total');
			// One line per turn, always on, so latency can be attributed to a stage
			// straight from the Vercel logs.
			console.log(
				'[HuntBot timing]',
				JSON.stringify({
					lane: turn.lane,
					model: turn.model,
					quick_score: Number(laneDecision.quickScore.toFixed(3)),
					deep_score: Number(laneDecision.deepScore.toFixed(3)),
					rerank_engine: turn.rerankEngine,
					rerank_failed: turn.rerankFailed || undefined,
					answers_question:
						turn.contextAnswersQuestion === null
							? undefined
							: Number(turn.contextAnswersQuestion.toFixed(2)),
					router_gate: turn.routerGate,
					router_ran: turn.routerRan,
					retrieval_failed: turn.retrievalError ? true : undefined,
					model_failure: turn.modelFailure ?? undefined,
					excluded_by_audit: turn.excludedByAudit || undefined,
					ip_org_class: turn.visitor?.org?.orgClass,
					...timer.timings
				})
			);
			sendTurnAnalytics();
		}
	});

	return createUIMessageStreamResponse({ stream });
};
