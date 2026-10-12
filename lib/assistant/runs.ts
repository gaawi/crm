import "server-only";
import { z } from "zod";
import { sql } from "@/lib/db";
import { noEmDash } from "@/lib/text/no-em-dash";

/**
 * The run log of the daily campaign assistant (see the assistant_runs
 * migration). A run is opened when the routine starts and closed with its
 * report; the API writes it makes in between are attached to it. A write
 * that comes without an open run is still logged (run_id null), so nothing
 * the assistant did is ever invisible.
 */

/** A run left open longer than this is considered abandoned: later writes no longer attach to it. */
const RUN_WINDOW = "3 hours";

export class RunsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const bodySchema = z.object({
  action: z.enum(["start", "finish"]),
  runId: z.guid().nullish(),
  model: z.string().trim().max(100).nullish(),
  report: z.string().trim().max(20_000).nullish(),
});

/** POST /api/assistant-agent/runs: {"action": "start", "model"?} → {runId}; {"action": "finish", "runId"?, "report"} closes it. */
export async function applyRun(body: unknown): Promise<{ ok: true; runId: string }> {
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) throw new RunsError(`Send {"action": "start", "model"?} or {"action": "finish", "runId"?, "report"}.`, 400);
  const input = parsed.data;
  if (input.action === "start") {
    // A new run closes any run left open (the previous one died without finishing).
    await sql`update assistant_runs set finished_at = now(), report = coalesce(report, 'Did not finish.') where finished_at is null`;
    const [run] = await sql<{ id: string }[]>`insert into assistant_runs (model) values (${input.model ?? null}) returning id`;
    return { ok: true, runId: run.id };
  }
  const id = input.runId ?? (await openRunId());
  if (!id) throw new RunsError("No open run to finish. Start one first.", 409);
  const report = input.report ? noEmDash(input.report) : null;
  const done = await sql`update assistant_runs set finished_at = now(), report = ${report} where id = ${id}`;
  if (!done.count) throw new RunsError(`Run ${id} not found.`, 404);
  return { ok: true, runId: id };
}

async function openRunId(): Promise<string | null> {
  const [run] = await sql<{ id: string }[]>`
    select id from assistant_runs
     where finished_at is null and started_at > now() - ${RUN_WINDOW}::interval
     order by started_at desc limit 1`;
  return run?.id ?? null;
}

/** Record one API write of the assistant (never throws: logging must not break the write). */
export async function logAssistantCall(endpoint: string, status: number, request: unknown, response: unknown): Promise<void> {
  try {
    const runId = await openRunId();
    await sql`
      insert into assistant_api_calls (run_id, endpoint, status, request, response)
      values (${runId}, ${endpoint}, ${status}, ${sql.json(toJson(request))}, ${sql.json(toJson(response))})`;
  } catch (error) {
    console.error("Assistant call log failed:", error);
  }
}

function toJson(value: unknown): never {
  return (value === undefined ? null : JSON.parse(JSON.stringify(value))) as never;
}

export interface AssistantRun {
  id: string | null;
  startedAt: string;
  finishedAt: string | null;
  model: string | null;
  report: string | null;
  calls: { at: string; endpoint: string; status: number; request: unknown; response: unknown }[];
}

/** Latest runs with their calls (newest first); writes made outside any run are grouped as one pseudo-run. */
export async function listAssistantRuns(limit = 15): Promise<AssistantRun[]> {
  const runs = await sql<{ id: string; startedAt: Date; finishedAt: Date | null; model: string | null; report: string | null }[]>`
    select id, started_at, finished_at, model, report from assistant_runs order by started_at desc limit ${limit}`;
  const ids = runs.map((r) => r.id);
  const calls = await sql<{ runId: string | null; at: Date; endpoint: string; status: number; request: unknown; response: unknown }[]>`
    select run_id, at, endpoint, status, request, response from assistant_api_calls
     where run_id = any(${ids}::uuid[]) or (run_id is null and at > now() - interval '14 days')
     order by at`;
  const byRun = new Map<string | null, AssistantRun["calls"]>();
  for (const c of calls) {
    const list = byRun.get(c.runId) ?? [];
    list.push({ at: c.at.toISOString(), endpoint: c.endpoint, status: c.status, request: c.request, response: c.response });
    byRun.set(c.runId, list);
  }
  const out: AssistantRun[] = runs.map((r) => ({
    id: r.id,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    model: r.model,
    report: r.report,
    calls: byRun.get(r.id) ?? [],
  }));
  const loose = byRun.get(null);
  if (loose?.length) {
    out.push({
      id: null,
      startedAt: loose[0].at,
      finishedAt: loose.at(-1)!.at,
      model: null,
      report: "Writes made outside a recorded run.",
      calls: loose,
    });
    out.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  return out;
}
