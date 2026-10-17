// The token a tab puts in its URL (`?hb=`) so the identity pixel's report can be matched to the chat.
// The browser generates it (visitorContext.ts); the server checks it (visitor-company.ts, rb2b.ts).

export const PIXEL_TOKEN_LENGTH = 12;
const PIXEL_TOKEN = /^[a-z0-9]{12,32}$/;

export const isPixelToken = (value: unknown): value is string =>
	typeof value === 'string' && PIXEL_TOKEN.test(value);
