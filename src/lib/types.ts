// These types help match the Open AI function definitions I created on their site with supported actions here

import type { Message } from 'ai/svelte';

export enum SupportedActions {
	route_to_page = 'route_to_page',
	minimize_chat = 'minimize_chat'
}

export enum FunctionState {
	loading = 'loading',
	success = 'success',
	failed = 'failed'
}

export type FunctionMessage = Omit<Message, 'data'> & {
	data: FunctionState;
};

export interface BotAction {
	name: SupportedActions;
	arguments: Record<string, string>;
}

export enum SupportedRoutes {
	gathers = '/case-studies/gathers',
	karooTwo = '/case-studies/karoo2',
	dashboard = '/case-studies/hammerhead-dashboard',
	home = '/',
	dovetail = '/case-studies/dovetail',
	climber = '/case-studies/climber',
	controlCenter = '/case-studies/control-center',
	goodIdea = '/case-studies/good-idea',
	alphaFlow = '/case-studies/alpha-flow',
	info = '/information',
	caseStudies = '/case-studies',
	projects = '/projects',
	isobFilm = '/projects/isob-film',
	inSearchOfBirch = '/projects/in-search-of-birch',
	gitd = '/projects/glow-in-the-dirt',
	lyngen = '/projects/lyngen',
	thePlug = '/projects/the-plug',
	fender = '/projects/fender',
	karooOne = '/projects/karoo-1',
	tcCouloir = '/projects/terminal-cancer',
	wcts = '/projects/we-came-to-sauna'
}

export enum UserRole {
	USER = 'user',
	ADMIN = 'admin'
}

export type User = {
	authenticated: boolean;
	role: UserRole;
};
