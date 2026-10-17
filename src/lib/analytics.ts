import { env } from '$env/dynamic/public';
import { getVisitorContext, hasGpc } from '$lib/visitorContext';

/** Removes the identity-pixel token (`?hb=`) from a URL before it's sent to analytics. */
function withoutPixelToken(url: string): string {
	try {
		const u = new URL(url);
		if (!u.searchParams.has('hb')) return url;
		u.searchParams.delete('hb');
		return u.toString();
	} catch {
		return url;
	}
}

/** Callers pass URLs too (the pageview's `$referrer`): scrub those the same way. */
function sanitizeProps(props: Record<string, unknown>): Record<string, unknown> {
	const out = { ...props };
	for (const key of ['$referrer', '$current_url']) {
		if (typeof out[key] === 'string') out[key] = withoutPixelToken(out[key] as string);
	}
	return out;
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
					$current_url: withoutPixelToken(window.location.href),
					$pathname: window.location.pathname,
					$host: window.location.host,
					$referrer: document.referrer ? withoutPixelToken(document.referrer) : '$direct',
					// $referrer above is overwritten by in-site navigation; these keep the arrival source
					landing_referrer: visitor.landingReferrer,
					via: visitor.via,
					utm_source: visitor.utmSource
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
			properties: sanitizeProps({ ...browserContext, ...properties })
		})
	}).catch(() => {});
}
