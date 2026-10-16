// Browser-side visitor context for HuntBot: how they arrived, what they've read, and a few
// harmless device hints. Sent with every chat turn; the server re-validates all of it
// (src/lib/server/visitor-context.ts) and reduces it to short labels before the model sees it.
//
// Everything is kept in sessionStorage (per tab, gone when the tab closes), and every storage
// access is try/catch since it can be blocked.

const KEY = 'huntbot_visitor_v1';
const MAX_PAGES = 10;
const SLUG = /^[a-z0-9-]{1,40}$/;

export type SeenPage = { path: string; seconds: number };

export type VisitorPayload = {
	via: string | null;
	utmSource: string | null;
	landingReferrer: string | null;
	pagesSeen: SeenPage[];
	timezone: string | null;
	device: 'mobile' | 'desktop';
	returning: boolean;
	gpc: boolean;
};

type Stored = {
	via: string | null;
	utmSource: string | null;
	landingReferrer: string | null;
	pagesSeen: SeenPage[];
};

let state: Stored | null = null;
let current: { path: string; since: number } | null = null;
let returning = false;

function slug(value: string | null): string | null {
	const v = value?.trim().toLowerCase() ?? '';
	return SLUG.test(v) ? v : null;
}

function load(): Stored | null {
	try {
		const raw = sessionStorage.getItem(KEY);
		return raw ? (JSON.parse(raw) as Stored) : null;
	} catch {
		return null;
	}
}

function save() {
	if (!state) return;
	try {
		sessionStorage.setItem(KEY, JSON.stringify(state));
	} catch {
		// storage blocked: context lives for this page load only
	}
}

/** Whether the visitor asked not to be tracked (Global Privacy Control). */
export function hasGpc(): boolean {
	return typeof navigator !== 'undefined' && (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}

/**
 * Call once on first load. Reads the landing referrer and ?via= / ?utm_source= slugs, then strips
 * them from the address bar so a link the visitor copies and forwards doesn't carry them along.
 */
export function initVisitorContext(wasReturning: boolean) {
	if (typeof window === 'undefined' || state) return;
	returning = wasReturning;

	const existing = load();
	if (existing) {
		state = existing;
		return;
	}

	const params = new URL(window.location.href).searchParams;
	let landingReferrer: string | null = null;
	try {
		if (document.referrer) {
			const host = new URL(document.referrer).hostname.replace(/^www\./, '');
			// An in-site referrer is just navigation, not an arrival source
			if (host && host !== window.location.hostname.replace(/^www\./, '')) landingReferrer = host;
		}
	} catch {
		// malformed referrer
	}

	state = {
		via: slug(params.get('via')),
		utmSource: slug(params.get('utm_source')),
		landingReferrer,
		pagesSeen: []
	};
	save();

	if (params.has('via') || params.has('utm_source')) {
		params.delete('via');
		params.delete('utm_source');
		const query = params.toString();
		try {
			history.replaceState(
				history.state,
				'',
				window.location.pathname + (query ? `?${query}` : '') + window.location.hash
			);
		} catch {
			// replaceState can throw in sandboxed frames
		}
	}
}

/** Call from afterNavigate. Closes out the previous page's dwell time and opens the new one. */
export function recordPageView(path: string) {
	if (typeof window === 'undefined') return;
	if (!state) initVisitorContext(false);
	if (!state || path.startsWith('/admin')) return;

	const now = Date.now();
	if (current && current.path !== path) {
		const seconds = Math.round((now - current.since) / 1000);
		state.pagesSeen = [...state.pagesSeen, { path: current.path, seconds }].slice(-MAX_PAGES);
		save();
	}
	if (!current || current.path !== path) current = { path, since: now };
}

export function getVisitorContext(): VisitorPayload {
	const base: Stored = state ?? { via: null, utmSource: null, landingReferrer: null, pagesSeen: [] };
	let timezone: string | null = null;
	try {
		timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
	} catch {
		// Intl unavailable
	}
	const mobile =
		typeof window !== 'undefined' &&
		(window.matchMedia('(max-width: 639px)').matches || window.matchMedia('(pointer: coarse)').matches);

	// The page they're on right now counts as seen too, with its dwell time so far
	const pagesSeen = current
		? [
				...base.pagesSeen,
				{ path: current.path, seconds: Math.round((Date.now() - current.since) / 1000) }
			].slice(-MAX_PAGES)
		: base.pagesSeen;

	return {
		via: base.via,
		utmSource: base.utmSource,
		landingReferrer: base.landingReferrer,
		pagesSeen,
		timezone,
		device: mobile ? 'mobile' : 'desktop',
		returning,
		gpc: hasGpc()
	};
}
