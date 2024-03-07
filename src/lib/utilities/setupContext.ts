import type { RequestEvent } from '@sveltejs/kit';

export async function crawlDocument(
	event: RequestEvent,
	url: string,
	splittingMethod: string,
	chunkSize: number,
	overlap: number
): Promise<void> {
	await event.fetch('/api/crawl', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			url,
			options: {
				splittingMethod,
				chunkSize,
				overlap
			}
		})
	});
}
