import { env } from '$env/dynamic/public';
import { getVisitorContext, hasGpc } from '$lib/visitorContext';

const ADMIN_KEY = 'huntbot_admin_browser';

/** Called from the admin pages, so this browser's own testing can be filtered out of analytics. */
export function markAdminBrowser() {
	try {
		localStorage.setItem(ADMIN_KEY, '1');
	} catch {
		// Storage blocked: events from this browser just won't carry the flag
	}
}

function isAdminBrowser(): boolean {
	try {
		return localStorage.getItem(ADMIN_KEY) === '1';
	} catch {
		return false;
	}
}

export function captureEvent(
	event: string,
	distinctId: string,
	properties: Record<string, unknown>
) {
	const key = env.PUBLIC_POSTHOG_API_KEY;
	if (!key) return;
	// Raw capture API (no posthog-js), so send the browser context ourselves — without a user
	// agent PostHog classifies every event as Automation traffic.
	// Global Privacy Control: no user agent, and ask PostHog not to geolocate from the IP.
	const gpc = hasGpc();
	const visitor = getVisitorContext();
	const browserContext =
		typeof window !== 'undefined'
			? {
					...(gpc ? { $geoip_disable: true, gpc: true } : { $raw_user_agent: navigator.userAgent }),
					$current_url: window.location.href,
					$pathname: window.location.pathname,
					$host: window.location.host,
					$referrer: document.referrer || '$direct',
					// $referrer above is overwritten by in-site navigation; these keep the arrival source
					landing_referrer: visitor.landingReferrer,
					via: visitor.via,
					utm_source: visitor.utmSource,
					// Server events get is_admin from the auth cookie; client events from a flag the
					// admin pages leave in this browser (the login cookie expires after an hour)
					...(isAdminBrowser() ? { is_admin: true } : {})
				}
			: {};
	fetch('https://us.i.posthog.com/capture/', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			api_key: key,
			event,
			distinct_id: distinctId,
			timestamp: new Date().toISOString(),
			properties: { ...browserContext, ...properties }
		})
	}).catch(() => {});
}
