export const prerender = 'auto';

export const load = ({ url }) => {
	// Exporting the pathname as a way to detect page changes
	const { pathname } = url;

	return {
		pathname
	};
};
