import { env } from '$env/dynamic/private';
import { displayName, lookupCompanyRoles } from '$lib/server/company-roles';
import { lookupIpOrg, type IpOrg } from '$lib/server/ip-org';
import { logToolCall } from '$lib/server/tool-log';
import { visitorContextEnabled } from '$lib/server/visitor-context';
import { json, type RequestHandler } from '@sveltejs/kit';

// The proactive "are you hiring for the <role> role?" opener. When the visitor's network belongs
// to a company that has open design roles, the chat posts the question itself on first open
// instead of waiting for a hiring question. It is a guess (VPN, coworking space, parent company),
// so it's phrased as a question and the chat route's prompt asks at most once per conversation.
// No LLM: the text is a template, so it can't invent a role.

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const none = json({ message: null });
	let body: { visitor?: { gpc?: unknown }; testOrg?: { name?: unknown; domain?: unknown } } = {};
	try {
		body = await request.json();
	} catch {
		// an empty body is fine
	}

	// Same gates as the chat route: kill switch and Global Privacy Control (no network lookup).
	if (!visitorContextEnabled()) return none;
	if (request.headers.get('sec-gpc') === '1' || body.visitor?.gpc === true) return none;

	// Eval runs (CRON_SECRET in x-huntbot-eval) can name a company, to exercise this without
	// being on a company network.
	const isEvalRun =
		Boolean(env.CRON_SECRET) && request.headers.get('x-huntbot-eval') === env.CRON_SECRET;
	let org: IpOrg | null = null;
	if (isEvalRun && typeof body.testOrg?.name === 'string') {
		org = {
			name: body.testOrg.name.slice(0, 80),
			domain: typeof body.testOrg.domain === 'string' ? body.testOrg.domain.slice(0, 80) : null,
			countryCode: null,
			orgClass: 'org'
		};
	} else {
		let ip: string | null = null;
		try {
			ip = getClientAddress();
		} catch {
			// not available in every runtime
		}
		org = await lookupIpOrg(ip);
	}
	if (!org || org.orgClass !== 'org') return none;

	const t0 = performance.now();
	const found = await lookupCompanyRoles(org);
	logToolCall(crypto.randomUUID(), {
		tool: 'company_roles',
		outcome: found.roles.length ? 'ok' : 'empty',
		ms: Math.round(performance.now() - t0),
		results: found.roles.length,
		source: found.source
	});
	const role = found.roles[0];
	if (!role) return none;

	return json({
		message: `Quick guess from your network: are you hiring for the ${role.title} role at ${displayName(found.company)}? If so, I can show how Hunter's work lines up.`,
		chip: `Yes, how does Hunter match the ${role.title} role?`,
		role: { title: role.title, url: role.url }
	});
};
