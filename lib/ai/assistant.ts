import "server-only";

/** A turn of the visible chat, as kept by the browser (plain text only). */
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** Events streamed to the browser as NDJSON, one JSON object per line. */
export type AssistantEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; id: string; name: string; label: string; status: "running" | "done" | "error" }
  | { type: "done"; stopReason: string | null }
  | { type: "error"; message: string };

/**
 * Run one assistant turn: manual streaming tool loop over getCrmTools() with
 * the Claude API (client.beta.messages.stream, model env.anthropicModel,
 * adaptive thinking, explicit effort, fallbacks "default"), appending the full
 * response content each iteration (append-only; thinking blocks passed back
 * unchanged), executing all tool_use blocks of a turn and returning all
 * tool_result blocks in one user message. Stops on end_turn, refusal,
 * max_tokens, or after MAX_ITERATIONS tool rounds. Emits events via onEvent.
 * `signal` aborts the request when the browser disconnects.
 */
export async function runAssistant(params: {
  history: ChatTurn[];
  onEvent: (event: AssistantEvent) => void;
  signal?: AbortSignal;
}): Promise<void> {
  void params;
  throw new Error("TODO");
}
