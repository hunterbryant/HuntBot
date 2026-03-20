// These types help match the AI SDK tool definitions with supported actions here

export enum SupportedActions {
	route_to_page = 'route_to_page',
	minimize_chat = 'minimize_chat',
	ask_clarifying_question = 'ask_clarifying_question',
	capture_lead_intent = 'capture_lead_intent'
}

export enum FunctionState {
	loading = 'loading',
	success = 'success',
	failed = 'failed'
}

// Synthetic message type for action feedback UI (minimize, route, lead capture).
// These are injected into the message list but never sent to the API.
export type FunctionMessage = {
	id: string;
	role: 'data';
	content: string;
	name?: string;
	data: FunctionState;
	parts: Array<{ type: string; text?: string }>;
};

export interface BotAction {
	name: SupportedActions;
	arguments: Record<string, string>;
}

export enum SupportedRoutes {
	gathers = '/case-studies/gathers',
	karooTwo = '/case-studies/karoo2',
	KarooTwentyFour = '/case-studies/karoo-24',
	dashboard = '/case-studies/hammerhead-dashboard',
	home = '/',
	dovetail = '/case-studies/dovetail',
	climber = '/case-studies/climber',
	controlCenter = '/case-studies/control-center',
	goodIdea = '/case-studies/good-idea',
	alphaFlow = '/case-studies/alpha-flow',
	compaionApp = '/case-studies/karoo-companion-app',
	workoutEcosystem = '/case-studies/workout-ecosystem',
	karooProfiles = '/case-studies/karoo-profiles',
	info = '/information',
	caseStudies = '/case-studies',
	projects = '/projects',
	isobFilm = '/projects/isob-film',
	inSearchOfBirch = '/projects/in-search-of-birch',
	glowInTheDirt = '/projects/glow-in-the-dirt',
	lyngen = '/projects/lyngen',
	thePlug = '/projects/the-plug',
	fender = '/projects/fender',
	karooOne = '/projects/karoo-1',
	terminalCancerCouloir = '/projects/terminal-cancer',
	weCameToSauna = '/projects/we-came-to-sauna'
}

export enum UserRole {
	USER = 'user',
	ADMIN = 'admin'
}

export type User = {
	authenticated: boolean;
	role: UserRole;
};
