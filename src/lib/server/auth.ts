import { env } from '$env/dynamic/private';
import type { Cookies } from '@sveltejs/kit';
import jwt from 'jsonwebtoken';

export const authenticateUser = (cookies: Cookies) => {
	// get the user token from the cookie
	const userToken = cookies.get('auth');

	// if the user token is not valid, return null
	// this is where you would check the user token against your database
	try {
		if (userToken) {
			const claims = jwt.verify(userToken, env.JWT_KEY as string);
			return claims as jwt.JwtPayload;
		}
	} catch (error) {
		console.log(error);
		return null;
	}
};
