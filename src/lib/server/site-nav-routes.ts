import { createClient } from '$lib/prismicio';

export type NavPage = {
	path: string;
	displayTitle: string;
	category: 'section' | 'case_study' | 'project';
};

type RouteCache = {
	routes: string[];
	pages: NavPage[];
	expires: number;
};

let routeCache: RouteCache | null = null;

/**
 * Cached Prismic-backed routes for chat tools and suggestion prompts.
 * Keeps one TTL cache for both path list and human labels.
 */
export async function getSiteNavCatalog(): Promise<{ routes: string[]; pages: NavPage[] }> {
	if (routeCache && routeCache.expires > Date.now()) {
		return { routes: routeCache.routes, pages: routeCache.pages };
	}

	const client = createClient();
	const [caseStudies, projects] = await Promise.all([
		client.getAllByType('case_study', { fetch: ['case_study.title', 'case_study.protected'] }),
		client.getAllByType('project', { fetch: ['project.title'] })
	]);

	const pages: NavPage[] = [
		{ path: '/', displayTitle: 'Home', category: 'section' },
		{ path: '/information', displayTitle: 'About', category: 'section' },
		{ path: '/case-studies', displayTitle: 'Case studies', category: 'section' },
		{ path: '/projects', displayTitle: 'Projects', category: 'section' },
		...caseStudies
			.filter((doc) => !doc.data.protected)
			.map(
				(doc): NavPage => ({
					path: `/case-studies/${doc.uid}`,
					displayTitle: doc.data.title || doc.uid,
					category: 'case_study'
				})
			),
		...projects.map(
			(doc): NavPage => ({
				path: `/projects/${doc.uid}`,
				displayTitle: doc.data.title || doc.uid,
				category: 'project'
			})
		)
	];

	const routes = pages.map((p) => p.path);
	routeCache = { routes, pages, expires: Date.now() + 5 * 60 * 1000 };
	return { routes, pages };
}

export async function getAvailableRoutes(): Promise<string[]> {
	const { routes } = await getSiteNavCatalog();
	return routes;
}

export function formatNavPagesForPrompt(pages: NavPage[], currentPage: string): string {
	return pages
		.filter((p) => p.path !== currentPage)
		.map((p) => {
			const kind =
				p.category === 'case_study'
					? 'case study'
					: p.category === 'project'
						? 'project'
						: 'page';
			return `- "${p.displayTitle}" (${kind}) → ${p.path}`;
		})
		.join('\n');
}
