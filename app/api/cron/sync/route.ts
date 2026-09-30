import { after } from "next/server";
import { hasCronSecret } from "@/lib/auth";
import { deadlineFor, runCron } from "@/lib/sync/runner";

export const maxDuration = 300;

/**
 * GET /api/cron/sync (Vercel Cron, Bearer CRON_SECRET): renew watches, fan out
 * sync/import jobs, autopilot. With `?async=1` (the Supabase pg_cron
 * scheduler, whose HTTP calls time out after a few seconds) it answers 202 at
 * once and does the work after the response.
 */
export async function GET(request: Request) {
  const start = Date.now();
  if (!hasCronSecret(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const deadline = deadlineFor(maxDuration, start);
  if (new URL(request.url).searchParams.get("async") === "1") {
    after(async () => {
      try {
        await runCron({ deadline });
      } catch (error) {
        console.error("Scheduled sync failed:", error);
      }
    });
    return Response.json({ accepted: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
  }
  const summary = await runCron({ deadline });
  return Response.json(summary, { headers: { "Cache-Control": "no-store" } });
}
