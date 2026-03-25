import {
	fetchHoverSuggestions,
	fetchScrollSuggestions,
	hoverSuggestions,
	scrollSuggestions
} from './MessageStore.svelte';

const DWELL_MS = 3000;
const MAX_FETCHES = 5;
const MIN_OBSERVABLE = 3;
const DEPTH_MILESTONES = [25, 50, 75];

const HOVER_DWELL_MS = 2000;
const HOVER_DECAY_MS = 15000;
const HOVER_COOLDOWN_MS = 3000;
const MAX_HOVER_FETCHES = 3;

function getScrollDepth(): number {
	const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
	const docHeight = document.documentElement.scrollHeight - viewportHeight;
	return docHeight > 0 ? Math.round((window.scrollY / docHeight) * 100) : 0;
}

function getObservableElements(): Element[] {
	const seen = new Set<Element>();
	const results: Element[] = [];

	document.querySelectorAll('h1, h2, h3, h4').forEach((el) => {
		seen.add(el);
		results.push(el);
	});

	document.querySelectorAll('[data-slice-type]').forEach((slice) => {
		const heading = slice.querySelector('h1, h2, h3, h4, h5');
		if (heading && !seen.has(heading)) {
			seen.add(heading);
			results.push(heading);
		}
	});

	return results;
}

function flashContextOverlay(el: Element) {
	const htmlEl = el as HTMLElement;

	const isDark =
		document.documentElement.classList.contains('dark') ||
		window.matchMedia('(prefers-color-scheme: dark)').matches;
	const highlight = isDark ? '#292524' : '#57534e';
	const textColor = getComputedStyle(htmlEl).color;

	const styledProps = [
		'background-image',
		'background-size',
		'background-position',
		'background-clip',
		'-webkit-background-clip',
		'-webkit-text-fill-color',
		'color',
		'transition'
	];
	const saved = new Map<string, string>();
	styledProps.forEach((p) => saved.set(p, htmlEl.style.getPropertyValue(p)));

	htmlEl.style.setProperty(
		'background-image',
		`linear-gradient(90deg, ${textColor} 0%, ${textColor} 35%, ${highlight} 50%, ${textColor} 65%, ${textColor} 100%)`
	);
	htmlEl.style.setProperty('background-size', '300% 100%');
	htmlEl.style.setProperty('background-position', '100% 0');
	htmlEl.style.setProperty('-webkit-background-clip', 'text');
	htmlEl.style.setProperty('background-clip', 'text');
	htmlEl.style.setProperty('-webkit-text-fill-color', 'transparent');
	htmlEl.style.setProperty('color', 'transparent');

	void htmlEl.offsetHeight;

	htmlEl.style.setProperty('transition', 'background-position 1400ms ease-in-out');
	htmlEl.style.setProperty('background-position', '0% 0');

	let cleaned = false;
	const cleanup = () => {
		if (cleaned) return;
		cleaned = true;
		htmlEl.removeEventListener('transitionend', cleanup);
		styledProps.forEach((p) => {
			const orig = saved.get(p)!;
			if (orig) htmlEl.style.setProperty(p, orig);
			else htmlEl.style.removeProperty(p);
		});
	};

	htmlEl.addEventListener('transitionend', cleanup, { once: true });
	setTimeout(cleanup, 1600);
}

function extractHoverContext(el: Element): string {
	const own = el.textContent?.trim() ?? '';
	const prev = el.previousElementSibling?.textContent?.trim() ?? '';
	const next = el.nextElementSibling?.textContent?.trim() ?? '';
	const parts = [prev, own, next].filter(Boolean);
	return parts.join(' ').slice(0, 500);
}

function fingerprint(text: string): string {
	return text.slice(0, 80);
}

export type PageSuggestionObservers = {
	reset: () => void;
	mount: (pathname: string) => void;
	rescheduleAfterNavigate: (pathname: string) => void;
};

export function createPageSuggestionObservers(getIsMobile: () => boolean): PageSuggestionObservers {
	let dwellTimer: ReturnType<typeof setTimeout> | null = null;
	let sectionObserver: IntersectionObserver | null = null;
	const fetchedHeadings = new Set<string>();
	let fetchCount = 0;

	let scrollFallbackTimer: ReturnType<typeof setTimeout> | null = null;
	let scrollFallbackHandler: (() => void) | null = null;
	const milestonesFired = new Set<number>();

	let hoverDwellTimer: ReturnType<typeof setTimeout> | null = null;
	let hoverDecayTimer: ReturnType<typeof setTimeout> | null = null;
	let hoverFetchCount = 0;
	let lastHoverFetchTime = 0;
	const hoveredFingerprints = new Set<string>();
	let hoverCleanups: (() => void)[] = [];

	let afterNavigateTimer: ReturnType<typeof setTimeout> | null = null;

	function canFetchScroll(): boolean {
		return fetchCount < MAX_FETCHES;
	}

	function setupScrollDepthFallback(pathname: string) {
		if (scrollFallbackHandler) window.removeEventListener('scroll', scrollFallbackHandler);

		scrollFallbackHandler = () => {
			if (scrollFallbackTimer) clearTimeout(scrollFallbackTimer);
			scrollFallbackTimer = setTimeout(() => {
				const depth = getScrollDepth();
				for (const milestone of DEPTH_MILESTONES) {
					if (depth >= milestone && !milestonesFired.has(milestone) && canFetchScroll()) {
						milestonesFired.add(milestone);
						fetchCount++;
						fetchScrollSuggestions(pathname, depth, null);
						break;
					}
				}
			}, DWELL_MS);
		};

		window.addEventListener('scroll', scrollFallbackHandler, { passive: true });
	}

	function setupHeadingObserver(pathname: string) {
		if (sectionObserver) sectionObserver.disconnect();

		const observables = getObservableElements();

		if (observables.length < MIN_OBSERVABLE) {
			setupScrollDepthFallback(pathname);
		}

		sectionObserver = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					const heading = entry.target.textContent?.trim() ?? null;
					if (!heading) continue;

					if (entry.isIntersecting && !fetchedHeadings.has(heading)) {
						if (dwellTimer) clearTimeout(dwellTimer);
						dwellTimer = setTimeout(() => {
							if (!canFetchScroll()) return;
							fetchedHeadings.add(heading);
							fetchCount++;
							fetchScrollSuggestions(pathname, getScrollDepth(), heading);
						}, DWELL_MS);
					} else if (!entry.isIntersecting && dwellTimer) {
						clearTimeout(dwellTimer);
						dwellTimer = null;
					}
				}
			},
			{ threshold: 0.5 }
		);

		observables.forEach((el) => sectionObserver!.observe(el));
	}

	function teardownHoverObserver() {
		hoverCleanups.forEach((fn) => fn());
		hoverCleanups = [];
		if (hoverDwellTimer) clearTimeout(hoverDwellTimer);
		hoverDwellTimer = null;
		if (hoverDecayTimer) clearTimeout(hoverDecayTimer);
		hoverDecayTimer = null;
		hoverFetchCount = 0;
		hoveredFingerprints.clear();
		hoverSuggestions.set([]);
	}

	function setupHoverObserver(pathname: string) {
		teardownHoverObserver();

		if (getIsMobile()) return;

		const targets = document.querySelectorAll(
			'[data-slice-type] p, [data-slice-type] blockquote, [data-slice-type] figcaption'
		);

		targets.forEach((el) => {
			const onEnter = () => {
				if (hoverDecayTimer) {
					clearTimeout(hoverDecayTimer);
					hoverDecayTimer = null;
				}
				if (hoverDwellTimer) clearTimeout(hoverDwellTimer);

				hoverDwellTimer = setTimeout(() => {
					if (hoverFetchCount >= MAX_HOVER_FETCHES) return;
					if (Date.now() - lastHoverFetchTime < HOVER_COOLDOWN_MS) return;
					const context = extractHoverContext(el);
					const fp = fingerprint(context);
					if (hoveredFingerprints.has(fp)) return;
					hoveredFingerprints.add(fp);
					hoverFetchCount++;
					lastHoverFetchTime = Date.now();
					flashContextOverlay(el);
					fetchHoverSuggestions(pathname, context);
				}, HOVER_DWELL_MS);
			};

			const onLeave = () => {
				if (hoverDwellTimer) {
					clearTimeout(hoverDwellTimer);
					hoverDwellTimer = null;
				}
				if (hoverDecayTimer) clearTimeout(hoverDecayTimer);
				hoverDecayTimer = setTimeout(() => {
					hoverSuggestions.set([]);
				}, HOVER_DECAY_MS);
			};

			el.addEventListener('mouseenter', onEnter);
			el.addEventListener('mouseleave', onLeave);
			hoverCleanups.push(() => {
				el.removeEventListener('mouseenter', onEnter);
				el.removeEventListener('mouseleave', onLeave);
			});
		});
	}

	function reset() {
		if (afterNavigateTimer) {
			clearTimeout(afterNavigateTimer);
			afterNavigateTimer = null;
		}
		if (sectionObserver) sectionObserver.disconnect();
		if (dwellTimer) clearTimeout(dwellTimer);
		dwellTimer = null;
		if (scrollFallbackTimer) clearTimeout(scrollFallbackTimer);
		scrollFallbackTimer = null;
		if (scrollFallbackHandler) {
			window.removeEventListener('scroll', scrollFallbackHandler);
			scrollFallbackHandler = null;
		}
		fetchedHeadings.clear();
		milestonesFired.clear();
		fetchCount = 0;
		scrollSuggestions.set([]);
		teardownHoverObserver();
	}

	return {
		reset,
		mount(pathname: string) {
			if (canFetchScroll()) {
				fetchCount++;
				fetchScrollSuggestions(pathname, getScrollDepth(), null);
			}
			setupHeadingObserver(pathname);
			setupHoverObserver(pathname);
		},
		rescheduleAfterNavigate(pathname: string) {
			reset();
			afterNavigateTimer = setTimeout(() => {
				afterNavigateTimer = null;
				setupHeadingObserver(pathname);
				setupHoverObserver(pathname);
			}, 300);
		}
	};
}
