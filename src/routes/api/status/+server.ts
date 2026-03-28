import { getStatus } from '$lib/server/status-config';
import { json, type RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async () => {
	const status = await getStatus();
	return json({ text: status?.text ?? null, updatedAt: status?.updatedAt ?? null });
};
