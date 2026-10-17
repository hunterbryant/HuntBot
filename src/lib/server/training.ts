import { env } from '$env/dynamic/private';

const API_ORIGIN = 'https://intervals.icu/api/v1';
const CACHE_TTL_MS = 15 * 60 * 1000;
const METERS_PER_MILE = 1609.344;
const FEET_PER_METER = 3.28084;

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
};

/**
 * One activity, stripped to what's safe to show anonymous visitors: no names, GPS,
 * start times, heart rate, weight or device details — a date and the effort only.
 */
export type TrainingActivity = {
	date: string; // YYYY-MM-DD, local
	sport: string;
	distanceMi: number;
	movingHours: number;
	elevationFt: number;
	avgWatts: number | null;
	trainingLoad: number | null;
};

export type WeeklySummary = {
	weeks: WeeklySportTotals[];
	fitness: WeeklyFitness[];
	/** Monday of the first week included and Sunday of the last — totals are by whole week. */
	firstDay: string | null;
	lastDay: string | null;
};

export type ActivityList = {
	activities: TrainingActivity[];
	/**
	 * Activities that came in through Strava. intervals.icu's API only returns an empty
	 * stub for those (Strava's terms), so they're counted in the weekly totals but missing
	 * from this per-activity list.
	 */
	hidden: number;
};

const cache = new Map<string, { value: unknown; expiresAt: number }>();

async function icuGet<T>(path: string, params: Record<string, string>): Promise<T | null> {
	const athleteId = env.INTERVALS_ATHLETE_ID;
	if (!athleteId || !env.INTERVALS_API_KEY) return null;

	const url = `${API_ORIGIN}/athlete/${encodeURIComponent(athleteId)}${path}?${new URLSearchParams(params)}`;
	const cached = cache.get(url);
	if (cached && cached.expiresAt > Date.now()) return cached.value as T;

	try {
		const res = await fetch(url, {
			headers: { Authorization: `Basic ${btoa(`API_KEY:${env.INTERVALS_API_KEY}`)}` },
			signal: AbortSignal.timeout(6000)
		});
		if (!res.ok) {
			console.warn('[HuntBot training] intervals.icu request failed', { path, status: res.status });
			return null;
		}
		const value = (await res.json()) as T;
		cache.set(url, { value, expiresAt: Date.now() + CACHE_TTL_MS });
		return value;
	} catch (error) {
		console.warn('[HuntBot training] intervals.icu request failed', {
			path,
			error: error instanceof Error ? error.message : String(error)
		});
		return null;
	}
}

function addDays(date: string, days: number): string {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

const round = (n: number, places = 1) => Math.round(n * 10 ** places) / 10 ** places;

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
	const rows = await icuGet<SummaryRow[]>('/athlete-summary.json', {
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
			form: round(row.form ?? 0)
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

/**
 * Per-activity rows for [start, end]. Strava-synced activities come back as empty stubs
 * and are only counted (`hidden`), so per-activity answers ("longest ride") can be
 * incomplete; weekly totals cover everything.
 */
export async function getActivities(start: string, end: string): Promise<ActivityList | null> {
	type ActivityRow = {
		type?: string;
		start_date_local?: string;
		distance?: number;
		moving_time?: number;
		total_elevation_gain?: number;
		icu_average_watts?: number;
		icu_training_load?: number;
	};

	const rows = await icuGet<ActivityRow[]>('/activities', {
		oldest: start,
		newest: `${end}T23:59:59`,
		fields: [
			'type',
			'start_date_local',
			'distance',
			'moving_time',
			'total_elevation_gain',
			'icu_average_watts',
			'icu_training_load'
		].join(',')
	});
	if (!rows) return null;

	const activities: TrainingActivity[] = [];
	let hidden = 0;
	for (const r of rows) {
		if (!r.type || !r.start_date_local) {
			hidden++;
			continue;
		}
		activities.push({
			date: r.start_date_local.slice(0, 10),
			sport: r.type,
			distanceMi: round((r.distance ?? 0) / METERS_PER_MILE),
			movingHours: round((r.moving_time ?? 0) / 3600, 2),
			elevationFt: Math.round((r.total_elevation_gain ?? 0) * FEET_PER_METER),
			avgWatts: r.icu_average_watts ? Math.round(r.icu_average_watts) : null,
			trainingLoad: r.icu_training_load ?? null
		});
	}
	activities.sort((a, b) => a.date.localeCompare(b.date));
	return { activities, hidden };
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

function toCsv<T extends Record<string, string | number | null>>(rows: T[], columns: (keyof T)[]) {
	return [columns.join(','), ...rows.map((r) => columns.map((c) => r[c] ?? '').join(','))].join(
		'\n'
	);
}

/** CSV files preloaded into the analysis sandbox, plus a note on what each holds. */
export function trainingDataFiles(
	summary: WeeklySummary,
	activities: ActivityList | null
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
			content: toCsv(summary.fitness, ['weekStart', 'fitness', 'fatigue', 'form'])
		}
	];
	if (activities) {
		files.push({
			path: 'activities.csv',
			content: toCsv(activities.activities, [
				'date',
				'sport',
				'distanceMi',
				'movingHours',
				'elevationFt',
				'avgWatts',
				'trainingLoad'
			])
		});
	}
	const note = activities
		? `activities.csv has ${activities.activities.length} activities; ${activities.hidden} more were synced from Strava and are only counted in weekly.csv.`
		: 'activities.csv is unavailable this turn.';
	return { files, note };
}
