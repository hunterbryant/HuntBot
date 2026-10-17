import {
	displayName,
	lookupCompanyRoles,
	rankRolesForHunter,
	scoreRoleForHunter
} from '$lib/server/company-roles';
import { simulatedOrg } from '$lib/server/ip-org';
import { allowLookup } from '$lib/server/lookup-limit';
import { logToolCall } from '$lib/server/tool-log';
import {
	companyAsOrg,
	logResolution,
	resolveVisitorCompany,
	type CompanySource
} from '$lib/server/visitor-company';
import { visitorContextEnabled } from '$lib/server/visitor-context';
import { json, type RequestHandler } from '@sveltejs/kit';

// The proactive "are you hiring for the <role> role?" opener. When the identification stack
// (visitor-company.ts) finds the visitor's company and it has open design roles, the chat posts the question itself on first open
// instead of waiting for a hiring question. It is a guess (VPN, coworking space, parent company),
// so it's phrased as a question and the chat route's prompt asks at most once per conversation.
// No LLM: the text is a template, so it can't invent a role.

// The web agent behind a company with no job board can take ~20s; the chat opener waits for it.
export const config = { maxDuration: 60 };

const LEAD: Record<CompanySource, string> = {
	simulated: 'Quick guess from your network:',
	stated: '',
	pixel: 'Quick guess:',
	referrer: 'Quick guess:',
	ip_company: 'Quick guess from your network:',
	ip_asn: 'Quick guess from your network:'
};

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const none = json({ message: null });
	let body: { visitor?: Record<string, unknown>; simulateOrg?: unknown } = {};
	try {
		body = await request.json();
	} catch {
		// an empty body is fine
	}

	// Same gates as the chat route: kill switch and Global Privacy Control (no network lookup).
	if (!visitorContextEnabled()) return none;
	// `/simulate <Company>` names a company on purpose, so it isn't a network lookup and GPC
	// doesn't apply; it only ever affects that visitor's own chat.
	// Anyone can simulate (it only changes their own chat); the rate limit below bounds the cost.
	const simulated = simulatedOrg(body.simulateOrg);
	let ip: string | null = null;
	try {
		ip = getClientAddress();
	} catch {
		// not available in every runtime
	}
	if (!allowLookup(ip))
		return json({ message: null, ...(simulated && { reason: 'rate_limited' }) });
	// Under GPC the IP layers are skipped; the pixel and what they told us still count.
	const gpc = request.headers.get('sec-gpc') === '1' || body.visitor?.gpc === true;
	const resolution = await resolveVisitorCompany({
		clientIp: ip,
		payload: body.visitor,
		gpc,
		simulated,
		// The pixel reports on page load, usually just before the chat opens: give it a moment.
		waitForPixelMs: 3000
	});
	logResolution(crypto.randomUUID(), 'opener', resolution);
	const org = companyAsOrg(resolution);
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
			// eslint-disable-next-line no-control-regex -- stripping control characters is the point
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

	// A company they named isn't a guess; everything else is, and says roughly where it came from.
	const lead = LEAD[resolution.company?.source ?? 'ip_asn'];
	const ask = (rest: string) =>
		lead ? `${lead} are you hiring for ${rest}` : `Are you hiring for ${rest}`;
	if (standsOut) {
		return json({
			message: `${ask(`the ${top.title} role at ${company}?`)} If so, I can show how Hunter's work lines up.`,
			options: [
				{ label: 'Yes, that one', reply: roleOption(top.title).reply },
				{ label: "No, I'm not hiring for that", reply: "No, I'm not hiring for that role." }
			]
		});
	}
	const shown = ranked.slice(0, 3);
	return json({
		message: `${ask(`one of these roles at ${company}?`)} If so, I can show how Hunter's work lines up.`,
		options: [
			...shown.map((r) => roleOption(r.title)),
			{ label: decline, reply: "No, I'm not hiring for these roles." }
		]
	});
};
