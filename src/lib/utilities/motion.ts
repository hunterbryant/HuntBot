/** True when the visitor asked their OS for less motion. Read at call time so a change applies. */
export function prefersReducedMotion(): boolean {
	return (
		typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(prefers-reduced-motion: reduce)').matches
	);
}
