import { z } from "zod";
import { assertSession, UnauthorizedError } from "@/lib/auth";
import { assistantErrorMessage, runAssistant, type AssistantEvent } from "@/lib/ai/assistant";

export const maxDuration = 300;

const Body = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(40_000) }))
    .min(1)
    .max(60),
});

/** POST { messages: ChatTurn[] } → NDJSON stream of AssistantEvent. */
export async function POST(request: Request) {
  try {
    await assertSession();
  } catch (error) {
    if (error instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    throw error;
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const history = parsed.data.messages.filter((m) => m.content.trim() !== "");
  if (history.at(-1)?.role !== "user") return Response.json({ error: "The last message must be from the user" }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AssistantEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // Client went away.
        }
      };
      try {
        await runAssistant({ history, onEvent: send, signal: request.signal });
      } catch (error) {
        if (!request.signal.aborted) {
          console.error("assistant error", error);
          send({ type: "error", message: assistantErrorMessage(error) });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
