import { env } from '$env/dynamic/private';
import type { NetworkPolicy } from '@vercel/sandbox';

const API_ORIGIN = 'https://intervals.icu/api/v1';
const CACHE_TTL_MS = 15 * 60 * 1000;
const METERS_PER_MILE = 1609.344;
const FEET_PER_METER = 3.28084;
const POUNDS_PER_KG = 2.20462;
// Each location lookup downloads the activity's full GPS track, so only the most recent
// ones get one.
const MAX_LOCATION_LOOKUPS = 50;
const LOCATION_LOOKUP_CONCURRENCY = 10;

/** One sport's totals for one Monday–Sunday week. */
export type WeeklySportTotals = {
	weekStart: string; // YYYY-MM-DD (Monday)
	sport: string; // intervals.icu category: Ride, Run, Swim, Workout, …
	count: number;
	distanceMi: number;
	movingHours: number;
	elevationFt: number;
	trainingLoad: number;
};

/** intervals.icu fitness model at the end of a week (CTL / ATL / TSB). */
export type WeeklyFitness = {
	weekStart: string;
	fitness: number;
	fatigue: number;
	form: number;
	weightLb: number | null;
};

/** One activity. Location columns are only filled when asked for (see getActivities). */
export type TrainingActivity = {
	date: string; // YYYY-MM-DD, local
	startTime: string; // HH:MM, local
	name: string;
	sport: string;
	distanceMi: number;
	movingHours: number;
	elevationFt: number;
	avgWatts: number | null;
	trainingLoad: number | null;
	avgHr: number | null;
	maxHr: number | null;
	weightLb: number | null;
	device: string | null;
	startLat: number | null;
	startLng: number | null;
	endLat: number | null;
	endLng: number | null;
	centerLat: number | null;
	centerLng: number | null;
};

type ActivityLocation = Pick<
	TrainingActivity,
	'startLat' | 'startLng' | 'endLat' | 'endLng' | 'centerLat' | 'centerLng'
>;

export type WeeklySummary = {
	weeks: WeeklySportTotals[];
	fitness: WeeklyFitness[];
	/** Monday of the first week included and Sunday of the last — totals are by whole week. */
	firstDay: string | null;
	lastDay: string | null;
};

export type ActivityList = {
	activities: TrainingActivity[];
	/** IDs of Hunter's own activities in the range, which the sandbox may read in full. */
	ids: string[];
	/**
	 * Activities that came in through Strava. intervals.icu's API only returns an empty
	 * stub for those (Strava's terms), so they're counted in the weekly totals but missing
	 * from this per-activity list.
	 */
	hidden: number;
};

const MAX_CACHE_ENTRIES = 200;
const cache = new Map<string, { value: unknown; expiresAt: number }>();

/** Stores a response, dropping expired entries and then the oldest ones past the cap. */
function cacheSet(url: string, value: unknown): void {
	const now = Date.now();
	for (const [key, entry] of cache) if (entry.expiresAt <= now) cache.delete(key);
	cache.delete(url);
	cache.set(url, { value, expiresAt: now + CACHE_TTL_MS });
	while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
}

/** Basic auth header for the intervals.icu API (user "API_KEY", password the key). */
function icuAuthHeader(): string {
	return `Basic ${btoa(`API_KEY:${env.INTERVALS_API_KEY}`)}`;
}

/**
 * GET `path` under the API root. Responses are cached per warm instance unless
 * `cacheResponse` is false (GPS tracks, which are big; callers cache what they keep).
 */
async function icuGet<T>(
	path: string,
	params: Record<string, string>,
	{ cacheResponse = true } = {}
): Promise<T | null> {
	if (!env.INTERVALS_ATHLETE_ID || !env.INTERVALS_API_KEY) return null;

	const url = `${API_ORIGIN}${path}?${new URLSearchParams(params)}`;
	const cached = cache.get(url);
	if (cached && cached.expiresAt > Date.now()) return cached.value as T;

	try {
		const res = await fetch(url, {
			headers: { Authorization: icuAuthHeader() },
			signal: AbortSignal.timeout(6000)
		});
		if (!res.ok) {
			console.warn('[HuntBot training] intervals.icu request failed', { path, status: res.status });
			return null;
		}
		const value = (await res.json()) as T;
		if (cacheResponse) cacheSet(url, value);
		return value;
	} catch (error) {
		console.warn('[HuntBot training] intervals.icu request failed', {
			path,
			error: error instanceof Error ? error.message : String(error)
		});
		return null;
	}
}

/** Null if `start`..`end` is a usable YYYY-MM-DD range, otherwise a message for the model. */
export function checkDateRange(start: string, end: string): string | null {
	const valid = (d: string) =>
		/^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d);
	if (!valid(start) || !valid(end)) {
		return 'Dates must be real calendar dates in YYYY-MM-DD form, e.g. 2026-01-31.';
	}
	if (start > end) return 'start_date is after end_date.';
	return null;
}

function addDays(date: string, days: number): string {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

const round = (n: number, places = 1) => Math.round(n * 10 ** places) / 10 ** places;

const athletePath = (path: string) =>
	`/athlete/${encodeURIComponent(env.INTERVALS_ATHLETE_ID ?? '')}${path}`;

/**
 * Weekly totals by sport for every week overlapping [start, end] (YYYY-MM-DD, inclusive).
 * These come from intervals.icu's own weekly buckets, which count every activity —
 * including Strava-synced ones the per-activity API hides — so they're the source of
 * truth for "how much did he ride" questions. Returns null if not configured or the
 * request fails.
 */
export async function getWeeklySummary(start: string, end: string): Promise<WeeklySummary | null> {
	type SummaryRow = {
		athlete_id: string;
		date: string;
		fitness?: number;
		fatigue?: number;
		form?: number;
		weight?: number;
		byCategory?: Array<{
			category: string;
			count: number;
			distance: number;
			moving_time: number;
			total_elevation_gain: number;
			training_load: number;
		}>;
	};

	// Buckets are anchored on Mondays, so reach back 6 days to include the week `start` falls in.
	const earliestAnchor = addDays(start, -6);
	const rows = await icuGet<SummaryRow[]>(athletePath('/athlete-summary.json'), {
		start: earliestAnchor,
		end
	});
	if (!rows) return null;

	// The endpoint also returns athletes Hunter follows; keep only his own rows.
	const own = rows
		.filter((r) => r.athlete_id === env.INTERVALS_ATHLETE_ID)
		.filter((r) => r.date >= earliestAnchor && r.date <= end)
		.sort((a, b) => a.date.localeCompare(b.date));

	const weeks: WeeklySportTotals[] = [];
	const fitness: WeeklyFitness[] = [];
	for (const row of own) {
		fitness.push({
			weekStart: row.date,
			fitness: round(row.fitness ?? 0),
			fatigue: round(row.fatigue ?? 0),
			form: round(row.form ?? 0),
			weightLb: row.weight ? round(row.weight * POUNDS_PER_KG) : null
		});
		for (const c of row.byCategory ?? []) {
			weeks.push({
				weekStart: row.date,
				sport: c.category,
				count: c.count,
				distanceMi: round(c.distance / METERS_PER_MILE),
				movingHours: round(c.moving_time / 3600, 2),
				elevationFt: Math.round(c.total_elevation_gain * FEET_PER_METER),
				trainingLoad: Math.round(c.training_load)
			});
		}
	}

	return {
		weeks,
		fitness,
		firstDay: own[0]?.date ?? null,
		lastDay: own.length ? addDays(own[own.length - 1].date, 6) : null
	};
}

// A finished activity's track never changes, so its location is kept for the instance's life.
const locationCache = new Map<string, ActivityLocation | null>();

const isLatLng = (p: number[] | undefined): p is [number, number] =>
	p?.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 90;

/**
 * Start, end and center (middle of the bounding box) of one activity's GPS track, to
 * 4 decimal places (about 10 m). Null for indoor activities and failed lookups.
 */
async function getActivityLocation(id: string): Promise<ActivityLocation | null> {
	if (locationCache.has(id)) return locationCache.get(id) ?? null;

	const map = await icuGet<{ bounds?: number[][]; latlngs?: number[][] }>(
		`/activity/${encodeURIComponent(id)}/map`,
		{},
		{ cacheResponse: false }
	);
	if (!map) return null; // Failed request: don't cache, so it's retried next time.

	const track = (map.latlngs ?? []).filter(isLatLng);
	const [a, b] = map.bounds ?? [];
	const first = track[0];
	const last = track[track.length - 1];
	const location: ActivityLocation | null =
		first && last
			? {
					startLat: round(first[0], 4),
					startLng: round(first[1], 4),
					endLat: round(last[0], 4),
					endLng: round(last[1], 4),
					centerLat: isLatLng(a) && isLatLng(b) ? round((a[0] + b[0]) / 2, 4) : null,
					centerLng: isLatLng(a) && isLatLng(b) ? round((a[1] + b[1]) / 2, 4) : null
				}
			: null;
	locationCache.set(id, location);
	return location;
}

/**
 * Per-activity rows for [start, end]. Strava-synced activities come back as empty stubs
 * and are only counted (`hidden`), so per-activity answers ("longest ride") can be
 * incomplete; weekly totals cover everything. `withLocation` adds start, end and center
 * coordinates for the most recent MAX_LOCATION_LOOKUPS outdoor activities, at one
 * track download each.
 */
export async function getActivities(
	start: string,
	end: string,
	{ withLocation = false } = {}
): Promise<ActivityList | null> {
	type ActivityRow = {
		id?: string;
		name?: string;
		type?: string;
		start_date_local?: string;
		distance?: number;
		moving_time?: number;
		total_elevation_gain?: number;
		icu_average_watts?: number;
		icu_training_load?: number;
		average_heartrate?: number;
		max_heartrate?: number;
		icu_weight?: number;
		device_name?: string;
		trainer?: boolean;
	};

	const rows = await icuGet<ActivityRow[]>(athletePath('/activities'), {
		oldest: start,
		newest: `${end}T23:59:59`,
		fields: [
			'id',
			'name',
			'type',
			'start_date_local',
			'distance',
			'moving_time',
			'total_elevation_gain',
			'icu_average_watts',
			'icu_training_load',
			'average_heartrate',
			'max_heartrate',
			'icu_weight',
			'device_name',
			'trainer'
		].join(',')
	});
	if (!rows) return null;

	const visible = rows.filter((r) => r.type && r.start_date_local);
	visible.sort((a, b) => (b.start_date_local ?? '').localeCompare(a.start_date_local ?? ''));

	const locations = new Map<string, ActivityLocation | null>();
	if (withLocation) {
		const queue = visible
			.filter((r) => r.id && !r.trainer && !r.type?.startsWith('Virtual'))
			.slice(0, MAX_LOCATION_LOOKUPS)
			.map((r) => r.id as string);
		await Promise.all(
			Array.from({ length: LOCATION_LOOKUP_CONCURRENCY }, async () => {
				for (let id = queue.shift(); id; id = queue.shift()) {
					locations.set(id, await getActivityLocation(id));
				}
			})
		);
	}

	const activities: TrainingActivity[] = visible.map((r) => {
		const location = r.id ? locations.get(r.id) : null;
		return {
			date: (r.start_date_local as string).slice(0, 10),
			startTime: (r.start_date_local as string).slice(11, 16),
			name: r.name?.trim() ?? '',
			sport: r.type as string,
			distanceMi: round((r.distance ?? 0) / METERS_PER_MILE),
			movingHours: round((r.moving_time ?? 0) / 3600, 2),
			elevationFt: Math.round((r.total_elevation_gain ?? 0) * FEET_PER_METER),
			avgWatts: r.icu_average_watts ? Math.round(r.icu_average_watts) : null,
			trainingLoad: r.icu_training_load ?? null,
			avgHr: r.average_heartrate || null,
			maxHr: r.max_heartrate || null,
			weightLb: r.icu_weight ? round(r.icu_weight * POUNDS_PER_KG) : null,
			device: r.device_name?.trim() || null,
			startLat: location?.startLat ?? null,
			startLng: location?.startLng ?? null,
			endLat: location?.endLat ?? null,
			endLng: location?.endLng ?? null,
			centerLat: location?.centerLat ?? null,
			centerLng: location?.centerLng ?? null
		};
	});
	activities.reverse();
	const ids = visible.flatMap((r) => (r.id && /^[A-Za-z0-9]+$/.test(r.id) ? [r.id] : []));
	return { activities, ids, hidden: rows.length - visible.length };
}

/** Sums weekly rows into one line per sport, biggest distance first, for the totals tool. */
export function formatTrainingTotals(summary: WeeklySummary): string {
	if (!summary.firstDay || summary.weeks.length === 0) return 'No training logged in that range.';

	const bySport = new Map<string, Omit<WeeklySportTotals, 'weekStart' | 'sport'>>();
	for (const w of summary.weeks) {
		const t = bySport.get(w.sport) ?? {
			count: 0,
			distanceMi: 0,
			movingHours: 0,
			elevationFt: 0,
			trainingLoad: 0
		};
		t.count += w.count;
		t.distanceMi += w.distanceMi;
		t.movingHours += w.movingHours;
		t.elevationFt += w.elevationFt;
		t.trainingLoad += w.trainingLoad;
		bySport.set(w.sport, t);
	}

	const lines = [...bySport.entries()]
		.sort((a, b) => b[1].distanceMi - a[1].distanceMi || b[1].movingHours - a[1].movingHours)
		.map(([sport, t]) =>
			[
				`${sport}: ${t.count} ${t.count === 1 ? 'activity' : 'activities'}`,
				t.distanceMi > 0 ? `${Math.round(t.distanceMi).toLocaleString('en-US')} mi` : null,
				`${Math.round(t.movingHours).toLocaleString('en-US')} h moving`,
				t.elevationFt > 0 ? `${t.elevationFt.toLocaleString('en-US')} ft climbing` : null
			]
				.filter(Boolean)
				.join(', ')
		);

	const latest = summary.fitness[summary.fitness.length - 1];
	return [
		`Whole weeks ${summary.firstDay} to ${summary.lastDay} (Monday–Sunday buckets, so the edges can include a few days outside the asked range):`,
		...lines,
		latest ? `Fitness (CTL) at the end of that span: ${Math.round(latest.fitness)}` : null
	]
		.filter(Boolean)
		.join('\n');
}

/**
 * Daily wellness rows (sleep, HRV, resting HR, readiness, steps, weight, …) for
 * [start, end], every scalar field intervals.icu has, in its own units. Null if not
 * configured or the request fails.
 */
export async function getWellness(
	start: string,
	end: string
): Promise<Record<string, string | number | null>[] | null> {
	const rows = await icuGet<Record<string, unknown>[]>(athletePath('/wellness'), {
		oldest: start,
		newest: end
	});
	if (!rows) return null;
	return rows.map((row) => {
		const out: Record<string, string | number | null> = {};
		for (const [key, value] of Object.entries(row)) {
			if (typeof value === 'number' || typeof value === 'string') out[key] = value;
			else if (typeof value === 'boolean') out[key] = value ? 1 : 0;
		}
		return out;
	});
}

const MAX_ALLOWED_ACTIVITY_IDS = 300;

/**
 * Sandbox network policy that lets analysis code read Hunter's own intervals.icu data:
 * GET requests to his athlete endpoints, the API spec, and `/activity/{id}/...` for the
 * activity IDs in `ownActivityIds` only. A bare activity ID doesn't prove who owns it
 * (athletes he follows or who shared with him have activities his key can open), so the
 * per-activity endpoints are limited to IDs that came from his own activity list. The API
 * key is added by Vercel's proxy, so it never enters the sandbox. Everything else —
 * other people's data (his chats, athlete-summary, which includes athletes he follows,
 * sharing lists, other athlete IDs), encoded or traversal paths, writes, deletes and
 * other hosts — is refused, since visitors write the prompts.
 */
export function intervalsNetworkPolicy(ownActivityIds: string[] = []): NetworkPolicy {
	const athleteId = env.INTERVALS_ATHLETE_ID ?? '';
	if (!env.INTERVALS_API_KEY || !/^[A-Za-z0-9]+$/.test(athleteId)) return 'deny-all';

	const activityIds = [...new Set(ownActivityIds)]
		.filter((id) => /^[A-Za-z0-9]+$/.test(id))
		.slice(0, MAX_ALLOWED_ACTIVITY_IDS);
	const readable = [
		'docs',
		`athlete/${athleteId}([/.].*)?`,
		...(activityIds.length ? [`activity/(${activityIds.join('|')})([/.].*)?`] : [])
	].join('|');

	const refuse = (body: string) => ({
		response: { statusCode: 403, body, contentType: 'text/plain' }
	});
	return {
		allow: {
			'intervals.icu': [
				{
					// Case-insensitive, and any percent-encoding at all is refused, so an encoded
					// letter can't slip past the names below and still match the allow rule.
					match: {
						path: {
							regex: `(?i)(\\.\\.|%|//|;|^/api/v1/athlete/${athleteId}/(chats|athlete-summary)|/shared-with)`
						}
					},
					...refuse("Not available to HuntBot: it holds other people's data.")
				},
				{
					match: { method: ['GET'], path: { regex: `^/api/v1/(${readable})$` } },
					transform: [{ headers: { authorization: icuAuthHeader() } }]
				},
				refuse(
					`Read-only access to Hunter's own data: GET /api/v1/athlete/${athleteId}/..., /api/v1/docs, and /api/v1/activity/{id}/... for activities in the loaded date range.`
				)
			]
		}
	};
}

/** Quotes a CSV cell when it holds a comma, quote or newline (activity names can). */
function csvCell(value: string | number | null | undefined): string {
	const s = value == null ? '' : String(value);
	return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv<T extends Record<string, string | number | null>>(rows: T[], columns: (keyof T)[]) {
	return [columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join(
		'\n'
	);
}

/** CSV files preloaded into the analysis sandbox, plus a note on what each holds. */
export function trainingDataFiles(
	summary: WeeklySummary,
	activities: ActivityList | null,
	wellness: Record<string, string | number | null>[] | null
): { files: { path: string; content: string }[]; note: string } {
	const files = [
		{
			path: 'weekly.csv',
			content: toCsv(summary.weeks, [
				'weekStart',
				'sport',
				'count',
				'distanceMi',
				'movingHours',
				'elevationFt',
				'trainingLoad'
			])
		},
		{
			path: 'fitness.csv',
			content: toCsv(summary.fitness, ['weekStart', 'fitness', 'fatigue', 'form', 'weightLb'])
		}
	];
	if (activities) {
		files.push({
			path: 'activities.csv',
			content: toCsv(activities.activities, [
				'date',
				'startTime',
				'name',
				'sport',
				'distanceMi',
				'movingHours',
				'elevationFt',
				'avgWatts',
				'trainingLoad',
				'avgHr',
				'maxHr',
				'weightLb',
				'device',
				'startLat',
				'startLng',
				'endLat',
				'endLng',
				'centerLat',
				'centerLng'
			])
		});
	}
	if (wellness) {
		const columns = [...new Set(wellness.flatMap((row) => Object.keys(row)))];
		// The day is the row id; put it first so the file reads like the others.
		columns.sort((a, b) => (a === 'id' ? -1 : b === 'id' ? 1 : a.localeCompare(b)));
		files.push({ path: 'wellness.csv', content: toCsv(wellness, columns) });
	}
	const note = [
		activities
			? `activities.csv has ${activities.activities.length} activities; ${activities.hidden} more were synced from Strava and are only counted in weekly.csv.`
			: 'activities.csv is unavailable this turn.',
		wellness
			? `wellness.csv has ${wellness.length} days.`
			: 'wellness.csv is unavailable this turn.'
	].join(' ');
	return { files, note };
}
