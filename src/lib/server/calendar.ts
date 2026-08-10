import { env } from '$env/dynamic/private';

const CALENDAR_ID = env.GOOGLE_CALENDAR_ID || 'primary';
// Assumption: adjust GOOGLE_CALENDAR_TIMEZONE if Hunter isn't Pacific.
const TIMEZONE = env.GOOGLE_CALENDAR_TIMEZONE || 'America/Los_Angeles';

export type CalendarEvent = {
	title: string;
	start: string; // ISO instant
	end: string; // ISO instant
	allDay: boolean;
};

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string | null> {
	if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
		return cachedToken.accessToken;
	}
	if (
		!env.GOOGLE_CALENDAR_CLIENT_ID ||
		!env.GOOGLE_CALENDAR_CLIENT_SECRET ||
		!env.GOOGLE_CALENDAR_REFRESH_TOKEN
	) {
		return null;
	}

	try {
		const res = await fetch('https://oauth2.googleapis.com/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				client_id: env.GOOGLE_CALENDAR_CLIENT_ID,
				client_secret: env.GOOGLE_CALENDAR_CLIENT_SECRET,
				refresh_token: env.GOOGLE_CALENDAR_REFRESH_TOKEN,
				grant_type: 'refresh_token'
			}),
			signal: AbortSignal.timeout(5000)
		});
		if (!res.ok) return null;

		const data: { access_token: string; expires_in: number } = await res.json();
		cachedToken = {
			accessToken: data.access_token,
			expiresAt: Date.now() + data.expires_in * 1000
		};
		return cachedToken.accessToken;
	} catch {
		return null;
	}
}

/** Offset (minutes) of `timeZone` from UTC at the given instant — handles DST correctly. */
function tzOffsetMinutes(instant: Date, timeZone: string): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hour12: false,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	}).formatToParts(instant);

	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
	const asUtc = Date.UTC(
		get('year'),
		get('month') - 1,
		get('day'),
		get('hour'),
		get('minute'),
		get('second')
	);
	return (asUtc - instant.getTime()) / 60_000;
}

/** UTC instant range covering local calendar day(s) [date, endDate] in `timeZone`, inclusive. */
function localDayRangeUtc(
	date: string,
	endDate: string,
	timeZone: string
): { startISO: string; endISO: string } {
	const offsetAtStart = tzOffsetMinutes(new Date(`${date}T12:00:00Z`), timeZone);
	const startUtcMs = Date.parse(`${date}T00:00:00Z`) - offsetAtStart * 60_000;

	const offsetAtEnd = tzOffsetMinutes(new Date(`${endDate}T12:00:00Z`), timeZone);
	const endMidnightUtcMs = Date.parse(`${endDate}T00:00:00Z`) - offsetAtEnd * 60_000;
	const endUtcMs = endMidnightUtcMs + 24 * 60 * 60 * 1000; // through end of endDate

	return {
		startISO: new Date(startUtcMs).toISOString(),
		endISO: new Date(endUtcMs).toISOString()
	};
}

/**
 * Fetches Hunter's calendar events covering local day(s) [date, endDate ?? date] in
 * TIMEZONE. Returns titles and times only — never attendees, locations, or
 * descriptions — since this is exposed to anonymous site visitors via the chat tool.
 * Returns null if calendar auth isn't configured or the request fails.
 */
export async function getCalendarEvents(
	date: string,
	endDate: string = date
): Promise<CalendarEvent[] | null> {
	const token = await getAccessToken();
	if (!token) return null;

	const { startISO, endISO } = localDayRangeUtc(date, endDate, TIMEZONE);

	const params = new URLSearchParams({
		timeMin: startISO,
		timeMax: endISO,
		singleEvents: 'true',
		orderBy: 'startTime',
		maxResults: '50'
	});

	try {
		const res = await fetch(
			`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events?${params}`,
			{ headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) }
		);
		if (!res.ok) return null;

		const data: {
			items: Array<{
				summary?: string;
				start: { date?: string; dateTime?: string };
				end: { date?: string; dateTime?: string };
			}>;
		} = await res.json();

		return data.items.map((item) => ({
			title: item.summary || 'Untitled event',
			start: item.start.dateTime ?? item.start.date ?? '',
			end: item.end.dateTime ?? item.end.date ?? '',
			allDay: !item.start.dateTime
		}));
	} catch {
		return null;
	}
}

/** Formats an ISO instant as a short local time string, e.g. "9:00 AM". */
export function formatEventTime(iso: string): string {
	return new Intl.DateTimeFormat('en-US', {
		timeZone: TIMEZONE,
		hour: 'numeric',
		minute: '2-digit',
		hour12: true
	}).format(new Date(iso));
}

export { TIMEZONE as CALENDAR_TIMEZONE };
