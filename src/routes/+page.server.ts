import { createClient } from '$lib/prismicio';

export const prerender = true;

export async function load({ fetch, cookies }) {
	const client = createClient({ fetch, cookies });

	// Used to fetch the inner content of the highlighted projects
	const graphQuery = `
    {
        home {
            landing_image
            meta_description
            meta_image
            meta_title
            slices {
                ...on content_highlight {
                    variation {
                        ...on default {
                            primary {
                                project {
                                    title
                                    hightlight_image
                                    date
                                    affiliation {
                                        title
                                    }
                                    responsibilities {
                                        skill
                                    }
                                }
                            }
                        }
                        ...on 3DModel {
                            primary {
                                project {
                                    title
                                    hightlight_image
                                    date
                                    affiliation {
                                        title
                                    }
                                    responsibilities {
                                        skill
                                    }
                                }
                                model
                            }
                        }
                    }
                }
            }
        }
    }`;

	const page = await client.getSingle('home', {
		graphQuery
	});

	return {
		page
	};
}

// export async function entries() {
// 	return [{}];
// }
