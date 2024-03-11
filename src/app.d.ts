// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces

declare namespace App {
	// interface Error {}
	interface Locals {
		user: jwt.JwtPayload | null;
	}
	// interface PageData {}
	// interface Platform {}
}
