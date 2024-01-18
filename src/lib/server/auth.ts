import type { Cookies } from '@sveltejs/kit';

export const authenticateUser = (cookies: Cookies) => {
	// get the user token from the cookie
	const userToken = cookies.get('auth');

	// if the user token is not valid, return null
	// this is where you would check the user token against your database
	// to see if it is valid and return the user object
	if (userToken === 'userToken') {
		const user = {
			authenticated: true
		};
		return user;
	}

	return null;
};
