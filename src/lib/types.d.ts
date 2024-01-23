// These types help match the Open AI function definitions I created on their site with supported actions here

export enum SupportedActions {
	route_to_page = 'route_to_page',
	minimize_chat = 'minimize_chat'
}

export interface BotAction {
	name: SupportedActions;
	arguments: Record<string, string>;
}

export enum SupportedRoutes {
	gathers = 'gathers',
	karooTwo = 'karoo-2',
	dashboard = 'hammerhead-dashboard',
	inSearchOfBirch = 'in-search-of-birch',
	home = 'home',
	dovetail = 'dovetail'
}
