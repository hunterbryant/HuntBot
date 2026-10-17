import {
	displayName,
	lookupCompanyRoles,
	rankRolesForHunter,
	scoreRoleForHunter
} from '$lib/server/company-roles';
import { lookupIpOrg, simulatedOrg, type IpOrg } from '$lib/server/ip-org';
import { logToolCall } from '$lib/server/tool-log';
import { visitorContextEnabled } from '$lib/server/visitor-context';
import { json, type RequestHandler } from '@sveltejs/kit';

// The proactive "are you hiring for the <role> role?" opener. When the visitor's network belongs
// to a company that has open design roles, the chat posts the question itself on first open
// instead of waiting for a hiring question. It is a guess (VPN, coworking space, parent company),
// so it's phrased as a question and the chat route's prompt asks at most once per conversation.
// No LLM: the text is a template, so it can't invent a role.

// The web agent behind a company with no job board can take ~20s; the chat opener waits for it.
export const config = { maxDuration: 60 };

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
	const found = await lookupCompanyRoles(org, { waitForWeb: true });
	logToolCall(crypto.randomUUID(), {
		tool: 'company_roles',
		outcome: found.roles.length ? 'ok' : 'empty',
		ms: Math.round(performance.now() - t0),
		results: found.roles.length,
		source: found.source
	});
	// Titles come from a careers page or a web search, then become chip text and a message the model
	// reads as the visitor's: strip control characters and line breaks, and cap the length.
	const clean = (t: string) =>
		t
			.replace(/[\u0000-\u001f\u007f]+/g, ' ')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 80);
	const ranked = rankRolesForHunter(
		found.roles.map((r) => ({ ...r, title: clean(r.title) })).filter((r) => r.title)
	);
	const top = ranked[0];
	if (!top) return miss('no_roles');
	const company = displayName(found.company);
	// One role stands out (or is the only one): ask about it. Otherwise show up to three.
	const standsOut =
		ranked.length === 1 || scoreRoleForHunter(top.title) - scoreRoleForHunter(ranked[1].title) >= 2;
	const decline = "No, I'm not hiring for these roles";
	const roleOption = (title: string) => ({
		label: title,
		reply: `Yes, I'm hiring for the ${title} role. How does Hunter match it?`
	});

	if (standsOut) {
		return json({
			message: `Quick guess from your network: are you hiring for the ${top.title} role at ${company}? If so, I can show how Hunter's work lines up.`,
			options: [
				{ label: 'Yes, that one', reply: roleOption(top.title).reply },
				{ label: "No, I'm not hiring for that", reply: "No, I'm not hiring for that role." }
			]
		});
	}
	const shown = ranked.slice(0, 3);
	return json({
		message: `Quick guess from your network: are you hiring for one of these roles at ${company}? If so, I can show how Hunter's work lines up.`,
		options: [
			...shown.map((r) => roleOption(r.title)),
			{ label: decline, reply: "No, I'm not hiring for these roles." }
		]
	});
};
