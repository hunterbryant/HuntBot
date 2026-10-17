import { displayName, lookupCompanyRoles } from '$lib/server/company-roles';
import { lookupIpOrg, simulatedOrg, type IpOrg } from '$lib/server/ip-org';
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
	let body: { visitor?: { gpc?: unknown }; simulateOrg?: unknown } = {};
	try {
		body = await request.json();
	} catch {
		// an empty body is fine
	}

	// Same gates as the chat route: kill switch and Global Privacy Control (no network lookup).
	if (!visitorContextEnabled()) return none;
	// `/simulate <Company>` names a company on purpose, so it isn't a network lookup and GPC
	// doesn't apply; it only ever affects that visitor's own chat.
	const simulated = simulatedOrg(body.simulateOrg);
	if (!simulated && (request.headers.get('sec-gpc') === '1' || body.visitor?.gpc === true)) {
		return none;
	}

	let org: IpOrg | null = simulated;
	if (!org) {
		let ip: string | null = null;
		try {
			ip = getClientAddress();
		} catch {
			// not available in every runtime
		}
		org = await lookupIpOrg(ip);
	}
	if (!org || org.orgClass !== 'org') return none;
	const miss = (reason: string) => json({ message: null, ...(simulated && { reason }) });

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
	if (!role) return miss('no_roles');

	return json({
		message: `Quick guess from your network: are you hiring for the ${role.title} role at ${displayName(found.company)}? If so, I can show how Hunter's work lines up.`,
		chip: `Yes, how does Hunter match the ${role.title} role?`,
		role: { title: role.title, url: role.url }
	});
};
