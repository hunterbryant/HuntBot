// These types help connect my Open AI function definitions with supported actions

export enum SupportedActions {
	route_to_page = 'route_to_page',
	minimize_chat = 'minimize_chat'
}

export interface BotAction {
	name: SupportedActions;
	arguments: Record<string, string>;
}
