// Browser-side visitor context for HuntBot: how they arrived, what they've read, and a few
// harmless device hints. Sent with every chat turn; the server re-validates all of it
// (src/lib/server/visitor-context.ts) and reduces it to short labels before the model sees it.
//
// Everything is kept in sessionStorage (per tab, gone when the tab closes), and every storage
// access is try/catch since it can be blocked.

import { PIXEL_TOKEN_LENGTH } from '$lib/pixel-token';

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
	/** Company named with `/simulate <Company>`; the server treats it as the visitor's network. */
	simulatedOrg: string | null;
	/** Where the visitor said they work, earlier in this chat (from find_open_roles). */
	statedCompany: string | null;
	/** Token this tab put in its first page URL, so the identity pixel's report can be matched. */
	pixelToken: string | null;
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

const SIM_KEY = 'huntbot_simulated_org';
const STATED_KEY = 'huntbot_stated_company';
const PIXEL_KEY = 'huntbot_hb';

export function getStatedCompany(): string | null {
	try {
		return sessionStorage.getItem(STATED_KEY);
	} catch {
		return null;
	}
}

export function setStatedCompany(name: string) {
	try {
		sessionStorage.setItem(STATED_KEY, name.slice(0, 80));
	} catch {
		// storage blocked: the chat route still sees it on the turn they said it
	}
}

let pixelTokenValue: string | null = null;

/** This tab's pixel token: random, made once per browser session. */
export function getPixelToken(): string | null {
	if (pixelTokenValue) return pixelTokenValue;
	try {
		pixelTokenValue = sessionStorage.getItem(PIXEL_KEY);
		if (!pixelTokenValue) {
			pixelTokenValue = Array.from(
				crypto.getRandomValues(new Uint8Array(PIXEL_TOKEN_LENGTH)),
				(b) => (b % 36).toString(36)
			).join('');
			sessionStorage.setItem(PIXEL_KEY, pixelTokenValue);
		}
	} catch {
		// storage blocked: the pixel layer just can't be matched to this chat
	}
	return pixelTokenValue;
}

/**
 * Loads the identity pixel (RB2B). It reports each identified page view, with the page URL, to our
 * webhook; putting this tab's token in the URL first (`?hb=`) is how a report finds its chat. The
 * token is removed from the address bar once the pixel has had time to record the page view, so a
 * copied link doesn't carry it (and anyone opening one gets their own token first anyway).
 */
export function loadIdentityPixel(key: string) {
	if (typeof window === 'undefined' || !/^[A-Z0-9]{6,32}$/.test(key)) return;
	// Same guard as RB2B's own install snippet, so it never loads twice.
	const w = window as { reb2b?: { loaded: boolean } };
	if (w.reb2b) return;
	w.reb2b = { loaded: true };
	const token = getPixelToken();
	const setParam = (value: string | null) => {
		try {
			const url = new URL(window.location.href);
			if (value) url.searchParams.set('hb', value);
			else url.searchParams.delete('hb');
			history.replaceState(history.state, '', url.pathname + url.search + url.hash);
		} catch {
			// replaceState can throw in sandboxed frames
		}
	};
	if (token) setParam(token);
	const script = document.createElement('script');
	script.async = true;
	script.src = `https://ddwl4m2hdecbv.cloudfront.net/b/${key}/${key}.js.gz`;
	document.head.appendChild(script);
	if (token) setTimeout(() => setParam(null), 20_000);
}

export function getSimulatedOrg(): string | null {
	try {
		return sessionStorage.getItem(SIM_KEY);
	} catch {
		return null;
	}
}

export function setSimulatedOrg(name: string | null) {
	try {
		if (name) sessionStorage.setItem(SIM_KEY, name);
		else sessionStorage.removeItem(SIM_KEY);
	} catch {
		// storage blocked: the simulation lasts until reload
	}
}

/** Whether the visitor asked not to be tracked (Global Privacy Control). */
export function hasGpc(): boolean {
	return (
		typeof navigator !== 'undefined' &&
		(navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl === true
	);
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
	const base: Stored = state ?? {
		via: null,
		utmSource: null,
		landingReferrer: null,
		pagesSeen: []
	};
	let timezone: string | null = null;
	try {
		timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
	} catch {
		// Intl unavailable
	}
	const mobile =
		typeof window !== 'undefined' &&
		(window.matchMedia('(max-width: 639px)').matches ||
			window.matchMedia('(pointer: coarse)').matches);

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
		gpc: hasGpc(),
		simulatedOrg: getSimulatedOrg(),
		statedCompany: getStatedCompany(),
		pixelToken: getPixelToken()
	};
}
