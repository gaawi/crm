import "server-only";
import { assistantApiGuard } from "@/lib/assistant/auth";
import { logAssistantCall } from "@/lib/assistant/runs";

type HttpError = Error & { status: number };

/**
 * A POST of the assistant API: token check, JSON body, the write itself, and
 * the run log (request + answer, errors included). `known` recognises the
 * write's own errors (shown to the routine with their status).
 */
export async function assistantWrite(
  request: Request,
  endpoint: string,
  apply: (body: unknown) => Promise<unknown>,
  known: (error: unknown) => error is HttpError,
  failure: string,
): Promise<Response> {
  const denied = await assistantApiGuard(request);
  if (denied) return denied;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    await logAssistantCall(endpoint, 400, null, { error: "Send a JSON body." });
    return Response.json({ error: "Send a JSON body." }, { status: 400 });
  }
  let status = 200;
  let result: unknown;
  try {
    result = await apply(body);
  } catch (error) {
    if (known(error)) {
      status = error.status;
      result = { error: error.message };
    } else {
      console.error(`Assistant ${endpoint} failed:`, error);
      status = 500;
      result = { error: failure };
    }
  }
  await logAssistantCall(endpoint, status, body, result);
  return Response.json(result, { status, headers: { "Cache-Control": "no-store" } });
}
