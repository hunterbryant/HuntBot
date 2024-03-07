import { crawlDocument } from '$lib/utilities/setupContext';
import { urls } from '$lib/utilities/urls';

export async function GET(event) {
	console.log('Server url list embed API endpoint hit');

	urls.forEach((url, i) => {
		crawlDocument(event, url.url, 'recursive', 512, 56).then(() => {
			console.log(`Crawled ${i} of ${urls.length}: ${url.url}`);
		});
	});

	return new Response('Hello', { status: 200 });
}
