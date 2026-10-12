import Link from "next/link";
import type { Metadata } from "next";
import { CircleAlert, CircleCheck } from "lucide-react";
import { PageHeader } from "@/components/ui/layout";
import { listAssistantRuns, type AssistantRun } from "@/lib/assistant/runs";
import { sql } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { env } from "@/lib/env";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Assistant runs" };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Every run of the daily campaign assistant: its report, and each write it
 * made (new versions, emails, contact cards, profiles, photos) with what the
 * app answered, skipped items and their reasons included. For auditing what
 * the routine really did.
 */
export default async function AssistantRunsPage() {
  const runs = await listAssistantRuns(20);
  const projects = new Map((await sql<{ id: string; name: string }[]>`select id, name from projects where sheet`).map((p) => [p.id, p.name]));
  const tz = env.timezone;
  return (
    <>
      <PageHeader
        title="Assistant runs"
        description="What the daily campaign assistant did on each run: new versions, emails proposed, contact cards, and what it skipped."
        back={{ href: "/more", label: "More" }}
      />
      {runs.length === 0 ? <p className="text-sm text-muted">No runs recorded yet.</p> : null}
      <div className="flex flex-col gap-4">
        {runs.map((run) => (
          <RunCard key={run.id ?? `loose-${run.startedAt}`} run={run} projects={projects} tz={tz} />
        ))}
      </div>
    </>
  );
}

function RunCard({ run, projects, tz }: { run: AssistantRun; projects: Map<string, string>; tz: string }) {
  const minutes = run.finishedAt ? Math.max(1, Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 60000)) : null;
  const errors = run.calls.filter((c) => c.status >= 400).length;
  return (
    <section className="rounded-xl border border-border bg-surface md:rounded-lg">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border px-4 py-2.5">
        <h2 className="text-[15px] font-semibold">{formatDateTime(new Date(run.startedAt), tz)}</h2>
        <span className="text-[12px] text-subtle">
          {run.id ? (run.finishedAt ? `${minutes} min` : "running or unfinished") : "outside a run"}
          {run.model ? ` · ${run.model}` : ""} · {run.calls.length} {run.calls.length === 1 ? "write" : "writes"}
        </span>
        {errors ? <span className="text-[12px] font-medium text-danger">{errors} failed</span> : null}
      </header>
      <div className="flex flex-col gap-3 px-4 py-3 text-[13px] leading-snug">
        {run.report ? <p className="whitespace-pre-wrap">{run.report}</p> : <p className="text-muted">No report.</p>}
        {run.calls.length ? (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {run.calls.map((call, i) => (
              <li key={i} className="px-3 py-2">
                <CallSummary call={call} projects={projects} tz={tz} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function CallSummary({ call, projects, tz }: { call: AssistantRun["calls"][number]; projects: Map<string, string>; tz: string }) {
  const req = obj(call.request);
  const res = obj(call.response);
  const failed = call.status >= 400;
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(call.at));
  const title = (() => {
    if (failed) return `${call.endpoint}: error ${call.status}`;
    if (call.endpoint === "proposals") {
      const created = obj(res.created);
      return `${projects.get(str(req.projectId)) ?? "Campaign"}: ${list(created.revisions).length} new versions, ${list(created.emails).length} emails, ${list(created.actions).length} actions`;
    }
    if (call.endpoint === "contacts") return `Contact cards: ${Number(res.updated ?? 0)} filled, ${Number(res.failed ?? 0)} failed`;
    if (call.endpoint === "profiles") return `Organization profiles: ${Number(res.updated ?? 0)} written, ${Number(res.failed ?? 0)} failed`;
    if (call.endpoint === "contact-photos") return `Photos: ${Number(res.updated ?? 0)} set, ${Number(res.failed ?? 0)} failed`;
    return call.endpoint;
  })();
  const skipped = list(res.skipped);
  const itemErrors = list(res.results).filter((r) => r.ok === false);
  const pending = list(res.pendingRevisions);
  const subjects = [...list(req.revisions).map((r) => `New version: ${str(r.subject)}`), ...list(req.emails).map((e) => `Email: ${str(e.subject)}`)];
  const ok = !failed && !skipped.length && !itemErrors.length && !pending.length;
  return (
    <details>
      <summary className="flex cursor-pointer list-none items-start gap-2">
        {ok ? (
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
        ) : (
          <CircleAlert className={cn("mt-0.5 size-4 shrink-0", failed ? "text-danger" : "text-warning")} aria-hidden />
        )}
        <span className="min-w-0 flex-1">
          {title}
          {skipped.length ? <span className="text-warning"> · {skipped.length} skipped</span> : null}
          {pending.length ? <span className="text-warning"> · {pending.length} change requests still waiting</span> : null}
        </span>
        <span className="shrink-0 text-[11px] text-subtle">{time}</span>
      </summary>
      <div className="mt-2 flex flex-col gap-1.5 pl-6 text-[12.5px]">
        {failed ? <p className="text-danger">{str(res.error)}</p> : null}
        {subjects.map((s, i) => (
          <p key={i} className="text-muted">
            {s}
          </p>
        ))}
        {skipped.map((s, i) => (
          <p key={`s${i}`} className="text-warning">
            Skipped {str(s.type)}: {str(s.reason)}
          </p>
        ))}
        {itemErrors.map((r, i) => (
          <p key={`e${i}`} className="text-warning">
            Item {String(r.index)}: {str(r.error)}
          </p>
        ))}
        {list(res.created && obj(res.created).revisions).length || list(obj(res.created).emails).length ? (
          <p>
            <Link href="/approvals/review" className="text-brand hover:underline">
              Review them
            </Link>
          </p>
        ) : null}
      </div>
    </details>
  );
}
