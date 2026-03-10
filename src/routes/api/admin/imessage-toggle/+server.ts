import { getImessageEnabled, setImessageEnabled } from '$lib/server/imessage-config';
import { json, type RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async () => {
	return json({ enabled: await getImessageEnabled() });
};

export const POST: RequestHandler = async ({ request }) => {
	const { enabled } = await request.json();
	await setImessageEnabled(Boolean(enabled));
	return json({ enabled: await getImessageEnabled() });
};
