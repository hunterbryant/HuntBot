import { auditUntaggedChunks } from '$lib/server/chunk-audit';
import { UserRole } from '$lib/types';
import { json, type RequestHandler } from '@sveltejs/kit';

// Leave headroom under the function limit for the last batch and its Qdrant write.
const RUN_BUDGET_MS = 45_000;

export const config = { maxDuration: 60 };

/**
 * Tags knowledge-base chunks that don't have a current `metadata.audit` yet (see
 * $lib/server/chunk-audit). Each call works for up to RUN_BUDGET_MS and reports `more: true`
 * when untagged chunks remain; the admin Embeddings page keeps calling until it's false.
 */
export const POST: RequestHandler = async ({ locals }) => {
	if (locals.user?.role !== UserRole.ADMIN) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const run = await auditUntaggedChunks(RUN_BUDGET_MS);
		console.log('[HuntBot chunk audit]', JSON.stringify(run));
		return json({ success: true, ...run });
	} catch (err) {
		console.error('Chunk audit failed:', err);
		return json({ success: false, error: String(err) }, { status: 500 });
	}
};
