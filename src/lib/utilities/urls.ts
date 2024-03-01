import { SupportedRoutes } from '$lib/types';

let urlList = [
	{
		url: 'https://www.hunterbryant.io/information',
		title: 'About Hunter',
		seeded: false,
		loading: false
	},
	{
		url: 'https://www.hunterbryant.io/case-studies',
		title: 'Hunters Case Studies',
		seeded: false,
		loading: false
	},
	{
		url: 'https://www.hunterbryant.io/projects',
		title: 'Hunters Personal Projects and Writing',
		seeded: false,
		loading: false
	},
	{
		url: 'https://www.linkedin.com/in/hunterbryant1/',
		title: 'Hunters LinkedIn',
		seeded: false,
		loading: false
	},
	{
		url: 'https://www.instagram.com/hunter.bryant/',
		title: 'Hunters instagram',
		seeded: false,
		loading: false
	}
];

Object.values(SupportedRoutes).forEach((route) => {
	urlList.push({
		url: `https://www.hunterbryant.io${route}`,
		title: route,
		seeded: false,
		loading: false
	});
});

export const urls = urlList;
