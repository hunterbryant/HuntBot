// The model sometimes writes a tool call as plain text instead of making it: its internal call
// syntax (" to=functions.capture_lead_intent", "<|channel|>" tokens) and the JSON arguments end
// up in the reply, sometimes with its own reasoning in between. Nothing from the marker on is
// meant for the visitor.
const LEAK_MARKER =
	/\sto=(?:functions|multi_tool_use)\.|<\|(?:start|end|message|channel|constrain|call|return)\|>/;

// Held back from each delta so a marker split across two deltas is still caught before any of it
// is sent. Longer than the longest marker; with word-sized chunks it delays the stream by a word.
const HOLD_BACK = 24;

const INTENT_TYPE = /"intent_type"\s*:\s*"(hiring|collaboration|general)"/;

/**
 * Filters one text part of the model stream. `push` each delta and send what it returns; `flush`
 * at the part's end. Once a leaked tool call shows up, the rest of the part is dropped.
 */
export class ToolCallLeakGuard {
	private pending = '';
	private dropped = '';
	// The last character already sent, so a held-back tail that starts mid-word ("in|to=…")
	// isn't read as starting a marker. A space, like the start of the part.
	private sentLast = ' ';
	tripped = false;

	push(delta: string): string {
		if (this.tripped) {
			this.dropped += delta;
			return '';
		}
		this.pending += delta;
		const match = LEAK_MARKER.exec(this.sentLast + this.pending);
		if (match) {
			this.tripped = true;
			// The match ran over sentLast + pending, so shift its index back by that one character
			const at = Math.max(0, match.index - 1);
			const safe = this.pending.slice(0, at).trimEnd();
			this.dropped = this.pending.slice(at);
			this.pending = '';
			return safe;
		}
		if (this.pending.length <= HOLD_BACK) return '';
		return this.send(this.pending.length - HOLD_BACK);
	}

	flush(): string {
		return this.tripped ? '' : this.send(this.pending.length);
	}

	private send(count: number): string {
		const out = this.pending.slice(0, count);
		this.pending = this.pending.slice(count);
		if (out) this.sentLast = out[out.length - 1];
		return out;
	}

	/** The client tool the leaked text was trying to call, if it named one we can stand in for. */
	leakedLeadIntent(): { intent_type: 'hiring' | 'collaboration' | 'general' } | null {
		if (!this.dropped.includes('capture_lead_intent')) return null;
		const type = INTENT_TYPE.exec(this.dropped)?.[1] as
			| 'hiring'
			| 'collaboration'
			| 'general'
			| undefined;
		return { intent_type: type ?? 'general' };
	}
}
