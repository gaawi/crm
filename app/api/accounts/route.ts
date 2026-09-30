import { databaseSizeMb, listAccountViews } from "@/lib/sync/accounts";
import { hasSession } from "@/lib/sync/http";

/** GET /api/accounts — connected accounts with import / sync status (Settings page polling). */
export async function GET(request: Request) {
  if (!(await hasSession(request))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const [accounts, databaseMb] = await Promise.all([listAccountViews(), databaseSizeMb()]);
  return Response.json({ accounts, databaseMb }, { headers: { "Cache-Control": "no-store" } });
}
