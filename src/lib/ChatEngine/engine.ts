import { SimpleChatEngine, type LLM } from 'llamaindex';

export async function createChatEngine(llm: LLM) {
	return new SimpleChatEngine({
		llm
	});
}
