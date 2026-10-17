import { env } from '$env/dynamic/private';
import { describeError } from '$lib/server/tool-log';
import { getRecord, putRecord } from '$lib/server/visitor-id-store';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, Output, zodSchema } from 'ai';
import { parse } from 'tldts';
import { z } from 'zod';

// The employer a referrer host gives away, if any. `acme.atlassian.net` or
// `acme.myworkdayjobs.com` say the visitor works at Acme; `notion.so`, `hunter.notion.site`, a blog
// or a news site say nothing about the reader. No hand-kept host list: each new host is classified
// once by a small model call and cached for 30 days, and a hard rule rejects any answer that names
// the host's own site (so a link from a Notion page can never make the visitor "from Notion").

export type ReferrerCompany = { name: string; domain: string | null };

const TIMEOUT_MS = 3000;
const memory = new Map<string, ReferrerCompany | null>();

const schema = z.object({
	company: z
		.string()
		.nullable()
		.describe("The visitor's employer, or null when the host doesn't show one."),
	domain: z.string().nullable().describe("That company's own web domain, e.g. acme.com, if known."),
	reason: z.string().describe('A few words on why.')
});

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Rejects an answer that is really the host's own site: the company name or domain matching the
 * registrable domain's label (notion.site -> "Notion", atlassian.net -> "Atlassian"). Exported for tests.
 */
export function namesHostItself(host: string, answer: ReferrerCompany): boolean {
	const info = parse(host, { allowPrivateDomains: false });
	const label = info.domainWithoutSuffix ? norm(info.domainWithoutSuffix) : '';
	if (!label) return true;
	const name = norm(answer.name);
	const domainLabel = answer.domain
		? norm(parse(answer.domain).domainWithoutSuffix ?? answer.domain)
		: '';
	const prefix = name.length >= 3 && (name.startsWith(label) || label.startsWith(name));
	return name === label || prefix || domainLabel === label;
}

/**
 * Hosts that can't name an employer whatever a model says: a host with no subdomain (the site
 * itself, e.g. uber.com or notion.so), or a public-hosting suffix where anyone gets a subdomain
 * (github.io, vercel.app, netlify.app... the Public Suffix List's private section). Exported for tests.
 */
export function cannotNameEmployer(host: string): boolean {
	const icann = parse(host, { allowPrivateDomains: false });
	const all = parse(host, { allowPrivateDomains: true });
	if (!icann.domain || !icann.subdomain || icann.subdomain === 'www') return true;
	// A private (public-hosting) suffix: `x.github.io` registers `x` as its own site.
	return all.publicSuffix !== icann.publicSuffix;
}

async function classify(host: string): Promise<ReferrerCompany | null> {
	const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
	const { output } = await generateText({
		model: openai.responses('gpt-6-luna'),
		output: Output.object({ schema: zodSchema(schema) }),
		reasoning: 'low',
		abortSignal: AbortSignal.timeout(TIMEOUT_MS),
		providerOptions: { openai: { reasoningSummary: null } },
		prompt: `A visitor arrived at a personal portfolio site from a link on the host "${host}" (only the host is known, not the page). Does that host show which company the visitor works at? It does only when it is a workplace tool's tenant subdomain that only that company's employees use, and the subdomain names the company: for example acme.atlassian.net, acme.myworkdayjobs.com, acme.sharepoint.com, acme.lightning.force.com, acme.okta.com, acme.service-now.com, acme.zendesk.com → the employer is Acme. Answer null when the host is the software vendor itself, a personal or public publishing page (anyone can publish on Notion, GitHub Pages, Substack, Medium, Webflow, Framer), a blog, news, search, social, email or docs site, a job board, or when you are not sure.`
	});
	const name = output.company?.trim();
	if (!name) return null;
	const answer = { name: name.slice(0, 80), domain: output.domain?.trim().toLowerCase() || null };
	return namesHostItself(host, answer) ? null : answer;
}

/** The employer a referrer host reveals, or null. Cached per host (memory + shared store). Never throws. */
export async function companyFromReferrer(host: string | null): Promise<ReferrerCompany | null> {
	if (!host) return null;
	host = host.toLowerCase();
	if (cannotNameEmployer(host)) return null;
	if (memory.has(host)) return memory.get(host) ?? null;

	const stored = await getRecord('referrer', host);
	if (stored) {
		const value =
			typeof stored.name === 'string'
				? { name: stored.name, domain: typeof stored.domain === 'string' ? stored.domain : null }
				: null;
		memory.set(host, value);
		return value;
	}
	if (!env.OPENAI_API_KEY) return null;
	try {
		const value = await classify(host);
		memory.set(host, value);
		await putRecord('referrer', host, value ? { name: value.name, domain: value.domain } : {});
		return value;
	} catch (error) {
		console.warn('[HuntBot visitor-id] referrer classification failed', {
			error: describeError(error)
		});
		return null;
	}
}
