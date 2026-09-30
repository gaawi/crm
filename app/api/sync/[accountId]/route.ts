import { after } from "next/server";
import { hasCronSecret } from "@/lib/auth";
import { getAccount } from "@/lib/sync/accounts";
import { hasSession } from "@/lib/sync/http";
import { deadlineFor, runAccountJob } from "@/lib/sync/runner";
import { HOP_HEADER } from "@/lib/sync/trigger";

export const maxDuration = 300;

/**
 * POST /api/sync/{accountId}?mode=backfill|sync — run one import chunk or an
 * incremental sync in after() and answer 202 at once. Called by the app itself
 * (Bearer CRON_SECRET, x-crm-hop) and by the Settings page (session).
 */
export async function POST(request: Request, ctx: RouteContext<"/api/sync/[accountId]">) {
  const start = Date.now();
  const internal = hasCronSecret(request);
  if (!internal && !(await hasSession(request))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { accountId } = await ctx.params;
  const mode = new URL(request.url).searchParams.get("mode") ?? "sync";
  if (mode !== "backfill" && mode !== "sync") {
    return Response.json({ error: "mode must be backfill or sync" }, { status: 400 });
  }
  const account = await getAccount(accountId);
  if (!account) return Response.json({ error: "not found" }, { status: 404 });

  // Only the app's own chained requests carry a hop count; the Settings page starts a fresh chain.
  const rawHop = internal ? Number.parseInt(request.headers.get(HOP_HEADER) ?? "0", 10) : 0;
  const hop = Number.isFinite(rawHop) && rawHop > 0 ? Math.min(rawHop, 100) : 0;

  const deadline = deadlineFor(maxDuration, start);
  after(async () => {
    try {
      await runAccountJob(account.id, mode, { deadline, hop });
    } catch (error) {
      console.error(`${mode} job for ${account.email} failed`, error);
    }
  });
  return Response.json({ accepted: true, mode }, { status: 202 });
}
