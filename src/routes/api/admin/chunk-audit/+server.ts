import { env } from '$env/dynamic/private';
import {
	auditUntaggedChunks,
	getChunkAuditStatus,
	saveChunkAuditStatus,
	type ChunkAuditStatus
} from '$lib/server/chunk-audit';
import { UserRole } from '$lib/types';
import { json, type RequestHandler } from '@sveltejs/kit';
import { waitUntil } from '@vercel/functions';

// Leave headroom under the function limit for the last batch and its Qdrant writes.
const RUN_BUDGET_MS = 45_000;
// Runs save progress every ~45s, so a `running` status older than this means the chain died.
const STALE_AFTER_MS = 3 * 60_000;

export const config = { maxDuration: 60 };

/**
 * Background chunk audit (see $lib/server/chunk-audit). The admin page's POST starts it and
 * returns at once; the work runs after the response (`waitUntil`) for up to RUN_BUDGET_MS, then,
 * if untagged chunks remain, calls this endpoint again to start the next run — authorized with
 * CRON_SECRET, since the admin's login cookie expires after an hour. Progress is saved after
 * every run, and GET returns it so the admin page can show "running" or "done" whenever it's
 * opened. Clicking Audit again resumes a chain that stopped.
 */

function isAdmin(locals: App.Locals): boolean {
	return locals.user?.role === UserRole.ADMIN;
}

function isChainedRun(request: Request): boolean {
	return !!env.CRON_SECRET && request.headers.get('authorization') === `Bearer ${env.CRON_SECRET}`;
}

function isStale(status: ChunkAuditStatus): boolean {
	return Date.now() - new Date(status.updatedAt).getTime() > STALE_AFTER_MS;
}

/** Start the next run as its own function invocation, so each one gets a fresh time limit. */
async function startNextRun(origin: string): Promise<void> {
	if (!env.CRON_SECRET) {
		throw new Error('CRON_SECRET is not set, so the audit cannot continue on its own');
	}
	const headers: Record<string, string> = { authorization: `Bearer ${env.CRON_SECRET}` };
	// Lets the self-call through Vercel Deployment Protection on preview deployments.
	if (env.VERCEL_AUTOMATION_BYPASS_SECRET) {
		headers['x-vercel-protection-bypass'] = env.VERCEL_AUTOMATION_BYPASS_SECRET;
	}
	const res = await fetch(`${origin}/api/admin/chunk-audit`, { method: 'POST', headers });
	if (!res.ok) throw new Error(`Next run did not start (HTTP ${res.status})`);
}

async function runOnce(status: ChunkAuditStatus, origin: string): Promise<void> {
	try {
		const run = await auditUntaggedChunks(RUN_BUDGET_MS);
		console.log('[HuntBot chunk audit]', JSON.stringify(run));
		status.audited += run.audited;
		status.lowValue += run.lowValue;
		status.sensitive += run.sensitive;
		status.refused += run.refused;
		status.updatedAt = new Date().toISOString();
		if (run.more && run.audited === 0) {
			throw new Error('A full run tagged nothing, so it stopped instead of looping');
		}
		if (run.more) {
			await saveChunkAuditStatus(status);
			await startNextRun(origin);
			return;
		}
		status.state = 'done';
		status.finishedAt = status.updatedAt;
	} catch (err) {
		console.error('Chunk audit failed:', err);
		status.state = 'error';
		status.error = err instanceof Error ? err.message : String(err);
		status.updatedAt = new Date().toISOString();
	}
	await saveChunkAuditStatus(status).catch((err) =>
		console.error('Saving chunk audit status failed:', err)
	);
}

export const GET: RequestHandler = async ({ locals }) => {
	if (!isAdmin(locals)) return json({ error: 'Unauthorized' }, { status: 401 });
	const status = await getChunkAuditStatus().catch(() => null);
	return json({ status, stale: status?.state === 'running' && isStale(status) });
};

export const POST: RequestHandler = async ({ locals, request, url }) => {
	const chained = isChainedRun(request);
	if (!chained && !isAdmin(locals)) return json({ error: 'Unauthorized' }, { status: 401 });

	let status: ChunkAuditStatus;
	try {
		const current = await getChunkAuditStatus();
		if (chained) {
			if (current?.state !== 'running') return json({ started: false }, { status: 409 });
			status = current;
		} else if (current?.state === 'running' && !isStale(current)) {
			return json({ started: false, status: current }, { status: 409 });
		} else {
			const now = new Date().toISOString();
			status = {
				state: 'running',
				startedAt: now,
				updatedAt: now,
				finishedAt: null,
				audited: 0,
				lowValue: 0,
				sensitive: 0,
				refused: 0,
				error: null
			};
			await saveChunkAuditStatus(status);
		}
	} catch (err) {
		console.error('Chunk audit could not start:', err);
		return json({ error: String(err) }, { status: 500 });
	}

	waitUntil(runOnce(status, url.origin));
	return json({ started: true, status }, { status: 202 });
};
