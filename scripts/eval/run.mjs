#!/usr/bin/env node
// Eval harness for HuntBot's tools. Sends each case to a running deployment's /api/chat, reads the
// UI message stream, and checks which tools the model called, what they returned and what it said.
//
//   EVAL_BASE_URL=https://<preview>.vercel.app EVAL_CRON_SECRET=... node scripts/eval/run.mjs
//   node scripts/eval/run.mjs --group notion          # one group
//   node scripts/eval/run.mjs --id notion-last-week-sept --verbose
//
// Env: EVAL_BASE_URL (required), EVAL_CRON_SECRET (the deployment's CRON_SECRET; tags the turns as
// admin traffic so PostHog ignores them), EVAL_BYPASS_SECRET (Vercel Deployment Protection
// automation bypass, for previews), EVAL_COOKIE (a raw Cookie header, e.g. the _vercel_jwt a
// `?_vercel_share=` link sets). Uses real models and Hunter's real data, so run it sparingly.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};

const base = (process.env.EVAL_BASE_URL ?? '').replace(/\/$/, '');
if (!base) {
	console.error('Set EVAL_BASE_URL to the deployment to test.');
	process.exit(2);
}
const cases = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8'));
const only = opt('id');
const group = opt('group');
const verbose = flag('verbose');
const selected = cases.filter((c) => (!only || c.id === only) && (!group || c.group === group));
if (selected.length === 0) {
	console.error('No cases matched.');
	process.exit(2);
}

const headers = { 'content-type': 'application/json' };
if (process.env.EVAL_CRON_SECRET) headers['x-huntbot-eval'] = process.env.EVAL_CRON_SECRET;
if (process.env.EVAL_COOKIE) headers.cookie = process.env.EVAL_COOKIE;
if (process.env.EVAL_BYPASS_SECRET) {
	headers['x-vercel-protection-bypass'] = process.env.EVAL_BYPASS_SECRET;
}

/** One chat turn: returns the reply text, the tool calls (with outputs) and how long it took. */
async function turn(messages, sessionId) {
	const t0 = Date.now();
	const res = await fetch(`${base}/api/chat`, {
		method: 'POST',
		headers,
		body: JSON.stringify({ messages, sessionId, currentPage: '/' })
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

	let text = '';
	const calls = new Map();
	const decoder = new TextDecoder();
	let buffer = '';
	for await (const chunk of res.body) {
		buffer += decoder.decode(chunk, { stream: true });
		let i;
		while ((i = buffer.indexOf('\n\n')) >= 0) {
			const frame = buffer.slice(0, i);
			buffer = buffer.slice(i + 2);
			const data = frame
				.split('\n')
				.filter((l) => l.startsWith('data:'))
				.map((l) => l.slice(5).trim())
				.join('');
			if (!data || data === '[DONE]') continue;
			let part;
			try {
				part = JSON.parse(data);
			} catch {
				continue;
			}
			if (part.type === 'text-delta') text += part.delta;
			else if (part.type === 'tool-input-available') {
				calls.set(part.toolCallId, { tool: part.toolName, input: part.input, output: '' });
			} else if (part.type === 'tool-output-available') {
				const c = calls.get(part.toolCallId);
				if (c)
					c.output = typeof part.output === 'string' ? part.output : JSON.stringify(part.output);
			}
		}
	}
	return { text: text.trim(), calls: [...calls.values()], ms: Date.now() - t0 };
}

const rx = (s) => new RegExp(s, 'i');
const subset = (want, got) =>
	Object.entries(want).every(([k, v]) =>
		typeof v === 'string' ? rx(v).test(String(got?.[k] ?? '')) : got?.[k] === v
	);

/** Applies a case's checks to the final turn; returns a list of failure strings. */
function check(c, result) {
	const fails = [];
	for (const want of c.calls ?? []) {
		const hit = result.calls.some(
			(call) => call.tool === want.tool && (!want.input || subset(want.input, call.input))
		);
		if (!hit)
			fails.push(
				`expected a ${want.tool} call${want.input ? ` with ${JSON.stringify(want.input)}` : ''}`
			);
	}
	for (const tool of c.forbidCalls ?? []) {
		if (result.calls.some((call) => call.tool === tool)) fails.push(`should not call ${tool}`);
	}
	for (const pattern of c.outputIncludes ?? []) {
		if (!result.calls.some((call) => rx(pattern).test(call.output))) {
			fails.push(`no tool output matched /${pattern}/`);
		}
	}
	for (const pattern of c.replyIncludes ?? []) {
		if (!rx(pattern).test(result.text)) fails.push(`reply missing /${pattern}/`);
	}
	if (c.replyIncludesAny && !c.replyIncludesAny.some((p) => rx(p).test(result.text))) {
		fails.push(`reply matched none of ${c.replyIncludesAny.map((p) => `/${p}/`).join(', ')}`);
	}
	for (const pattern of c.replyExcludes ?? []) {
		if (rx(pattern).test(result.text)) fails.push(`reply matched /${pattern}/`);
	}
	if (!result.text) fails.push('empty reply');
	// A tool the model called wrongly twice in a row is a robustness smell even if it recovered.
	const rejected = result.calls.filter((call) =>
		/^(No property|Operator |Dates must|Can't sort|read needs|query needs|No database|Filter on|Checkbox |Property "|.* isn't (a number|an option))|matches several databases/.test(
			call.output
		)
	).length;
	if (rejected > (c.maxRejectedCalls ?? 1)) fails.push(`${rejected} tool calls were rejected`);
	if (result.calls.length > (c.maxToolCalls ?? 6)) fails.push(`${result.calls.length} tool calls`);
	return fails;
}

let failed = 0;
for (const c of selected) {
	const sessionId = `eval-${c.id}-${Date.now()}`;
	const messages = [];
	let result;
	try {
		for (const [i, text] of c.turns.entries()) {
			messages.push({ id: `u${i}`, role: 'user', parts: [{ type: 'text', text }] });
			result = await turn(messages, sessionId);
			if (i < c.turns.length - 1) {
				messages.push({
					id: `a${i}`,
					role: 'assistant',
					parts: [{ type: 'text', text: result.text }]
				});
			}
		}
	} catch (error) {
		failed++;
		console.log(`FAIL  ${c.id}  (${error.message})`);
		continue;
	}
	const fails = check(c, result);
	if (fails.length) failed++;
	const trace = result.calls
		.map((call) => `${call.tool}${call.input?.action ? `:${call.input.action}` : ''}`)
		.join(' > ');
	console.log(
		`${fails.length ? 'FAIL' : 'ok  '}  ${c.id}  ${result.ms}ms  [${trace || 'no tools'}]`
	);
	for (const f of fails) console.log(`        - ${f}`);
	if (verbose || fails.length) {
		console.log(`        reply: ${result.text.slice(0, 300).replace(/\n/g, ' ')}`);
		if (verbose) {
			for (const call of result.calls) {
				console.log(`        ${call.tool} ${JSON.stringify(call.input).slice(0, 300)}`);
				console.log(`          -> ${call.output.slice(0, 300).replace(/\n/g, ' | ')}`);
			}
		}
	}
}
console.log(`\n${selected.length - failed}/${selected.length} passed`);
process.exit(failed ? 1 : 0);
