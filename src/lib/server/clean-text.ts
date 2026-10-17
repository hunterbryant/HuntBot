/**
 * One line of text, capped: control characters and line breaks become spaces, whitespace is
 * collapsed. For text from third parties (job boards, a web agent, RB2B) that ends up in chips,
 * messages the model reads, or the system prompt.
 */
export function oneLine(text: string, max: number): string {
	return (
		text
			// eslint-disable-next-line no-control-regex -- stripping control characters is the point
			.replace(/[\u0000-\u001f\u007f]+/g, ' ')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, max)
	);
}
