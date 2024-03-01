export async function crawlDocument(
	url: string,
	splittingMethod: string,
	chunkSize: number,
	overlap: number
): Promise<void> {
	await fetch('/api/crawl', {
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
