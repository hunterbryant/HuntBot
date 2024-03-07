export async function GET(event) {
	console.log('Server Notion embed API endpoint hit');

	return new Response('Hello', { status: 200 });
}
