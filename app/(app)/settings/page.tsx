import Link from "next/link";
import type { Metadata } from "next";
import { Plus, RefreshCw } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { Card, Notice, PageHeader } from "@/components/ui/layout";
import { SubmitButton } from "@/components/ui/submit-button";
import { sql } from "@/lib/db";
import { formatDateTime, formatRelative } from "@/lib/dates";
import { env } from "@/lib/env";
import { listProjects } from "@/lib/queries/projects";
import { getSettings } from "@/lib/queries/settings";
import { listAccountViews } from "@/lib/sync/accounts";
import type { GmailAccountView } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  disconnect,
  removeAccount,
  restartImport,
  resumeImport,
  saveAutopilot,
  saveProfile,
  setDefaultProject,
  syncNow,
} from "./actions";
import { ImportPump } from "./import-pump";

export const metadata: Metadata = { title: "Settings" };

const ERRORS: Record<string, string> = {
  state: "The sign-in link expired. Please try connecting again.",
  access_denied: "Access was not granted.",
  scopes: "Gmail access is required — please tick every permission on Google's screen.",
  confirm: "Tick the confirmation box to remove the account and its emails.",
};

const numberFormat = new Intl.NumberFormat("en-US");

function StatusLabel({ account }: { account: GmailAccountView }) {
  if (account.status === "reauth_required") return <Badge className="bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300">Needs reconnect</Badge>;
  if (account.status === "disconnected") return <Badge>Disconnected</Badge>;
  return <Badge className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">Connected</Badge>;
}

function ImportState({ account }: { account: GmailAccountView }) {
  if (account.backfillStatus === "done") {
    return <span>Import complete · {numberFormat.format(account.messageCount)} emails</span>;
  }
  const progress =
    account.backfillEstimate && account.backfillEstimate > 0
      ? Math.min(100, Math.round((account.backfillScanned / account.backfillEstimate) * 100))
      : null;
  return (
    <span className="flex w-full flex-col gap-1.5">
      <span>
        {account.backfillStalled ? "Import paused" : "Importing history"} · {numberFormat.format(account.backfillImported)} emails
        {account.backfillEstimate ? ` of ~${numberFormat.format(account.backfillEstimate)}` : ""}
      </span>
      {progress !== null ? (
        <span className="block h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
          <span className="block h-full rounded-full bg-accent transition-all" style={{ width: `${progress}%` }} />
        </span>
      ) : null}
    </span>
  );
}

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const params = await searchParams;
  const timezone = env.timezone;
  const [accounts, projects, profile, autopilot, defaults, [size]] = await Promise.all([
    listAccountViews(),
    listProjects(),
    getSettings("profile"),
    getSettings("autopilot"),
    sql<{ id: string; defaultProjectId: string | null }[]>`select id, default_project_id from gmail_accounts`,
    sql<{ mb: number }[]>`select (pg_database_size(current_database()) / 1048576)::int as mb`,
  ]);
  const defaultProject = new Map(defaults.map((d) => [d.id, d.defaultProjectId]));
  const importing = accounts.filter((a) => a.status === "active" && a.backfillStatus !== "done");
  const stalled = importing.filter((a) => a.backfillStalled).map((a) => a.id);
  const connected = typeof params.connected === "string" ? params.connected : null;
  const errorCode = typeof params.error === "string" ? params.error : null;
  const removing = typeof params.remove === "string" ? params.remove : null;
  const saved = typeof params.saved === "string" ? params.saved : null;
  const sizePercent = Math.min(100, Math.round((size.mb / env.dbSizeLimitMb) * 100));

  return (
    <>
      <PageHeader title="Settings" />
      <AutoRefresh active={importing.length > 0} seconds={8} />
      <ImportPump accountIds={stalled} />

      <div className="flex flex-col gap-6">
        {connected ? <Notice tone="success">Connected {connected}. The email history is being imported in the background.</Notice> : null}
        {errorCode ? <Notice tone="error">{ERRORS[errorCode] ?? errorCode}</Notice> : null}
        {saved ? <Notice tone="success">Saved.</Notice> : null}

        <Card
          title="Gmail accounts"
          description="Every email sent or received in these mailboxes is synced to the CRM."
          actions={
            <ButtonLink href="/api/google/connect" variant="primary" size="sm" prefetch={false}>
              <Plus className="size-4" /> Connect
            </ButtonLink>
          }
          bodyClassName="p-0"
        >
          {accounts.length === 0 ? (
            <div className="flex flex-col items-start gap-3 p-4 text-sm text-muted">
              <p>No mailbox connected yet. Connect each Gmail or Google Workspace account you use — the first import runs in the background.</p>
              <ButtonLink href="/api/google/connect" variant="primary" prefetch={false}>
                Connect Gmail account
              </ButtonLink>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {accounts.map((account) => (
                <li key={account.id} className="flex flex-col gap-3 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 truncate text-[15px] font-medium md:text-sm">{account.email}</span>
                    <StatusLabel account={account} />
                    {account.status === "active" ? (
                      <Badge className={cn(account.pushActive ? "" : "text-subtle")}>{account.pushActive ? "Live sync" : "Periodic sync"}</Badge>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-1 text-sm text-muted">
                    <ImportState account={account} />
                    <span title={account.lastSyncedAt ? formatDateTime(account.lastSyncedAt, timezone) : undefined}>
                      Last synced {formatRelative(account.lastSyncedAt, timezone)}
                    </span>
                    {account.lastError ? (
                      <span className="text-danger" title={account.lastError}>
                        {account.lastError.length > 160 ? `${account.lastError.slice(0, 160)}…` : account.lastError}
                      </span>
                    ) : null}
                  </div>

                  <form action={setDefaultProject.bind(null, account.id)} className="flex items-end gap-2">
                    <Field label="People from this mailbox join" className="flex-1">
                      <Select name="projectId" defaultValue={defaultProject.get(account.id) ?? ""}>
                        <option value="">No project</option>
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <SubmitButton variant="secondary" pendingLabel="…">
                      Save
                    </SubmitButton>
                  </form>

                  <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap">
                    {account.status === "active" ? (
                      <form action={syncNow.bind(null, account.id)}>
                        <SubmitButton variant="secondary" className="w-full" pendingLabel="Syncing…">
                          <RefreshCw className="size-4" /> Sync now
                        </SubmitButton>
                      </form>
                    ) : null}
                    {account.status === "active" && account.backfillStalled ? (
                      <form action={resumeImport.bind(null, account.id)}>
                        <SubmitButton variant="secondary" className="w-full" pendingLabel="Resuming…">
                          Resume import
                        </SubmitButton>
                      </form>
                    ) : null}
                    {account.status !== "active" ? (
                      <ButtonLink href={`/api/google/connect?login_hint=${encodeURIComponent(account.email)}`} variant="primary" prefetch={false}>
                        Reconnect
                      </ButtonLink>
                    ) : null}
                    <details className="col-span-2 md:col-auto">
                      <summary className="flex h-11 cursor-pointer list-none items-center justify-center rounded-lg px-3 text-sm text-muted active:bg-surface-2 md:h-8 md:justify-start md:hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
                        More…
                      </summary>
                      <div className="mt-2 flex flex-col gap-2 rounded-lg bg-surface-2 p-3">
                        <form action={restartImport.bind(null, account.id)}>
                          <SubmitButton variant="secondary" className="w-full md:w-auto" pendingLabel="Restarting…">
                            Re-scan the whole mailbox
                          </SubmitButton>
                        </form>
                        {account.status === "active" ? (
                          <form action={disconnect.bind(null, account.id)}>
                            <SubmitButton variant="secondary" className="w-full md:w-auto" pendingLabel="Disconnecting…">
                              Disconnect (keep emails)
                            </SubmitButton>
                          </form>
                        ) : null}
                        {removing === account.id ? (
                          <form action={removeAccount.bind(null, account.id)} className="flex flex-col gap-2">
                            <label className="flex items-center gap-2 text-sm">
                              <Checkbox name="confirm" value="yes" /> Delete this account and all its emails from the CRM
                            </label>
                            <SubmitButton variant="danger" pendingLabel="Removing…">
                              Remove permanently
                            </SubmitButton>
                          </form>
                        ) : (
                          <Link href={`/settings?remove=${account.id}`} className="text-sm text-danger">
                            Remove account and its emails…
                          </Link>
                        )}
                      </div>
                    </details>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="How Claude writes" description="Used for every email Claude prepares.">
          <form action={saveProfile} className="flex flex-col gap-3">
            <Field label="Your name">
              <Input name="name" defaultValue={profile.name} placeholder="Ana" />
            </Field>
            <Field label="Signature" hint="Added exactly as written at the end of Claude's emails.">
              <Textarea name="signature" rows={3} defaultValue={profile.signature} placeholder={"Ana García\nCreArtBox"} />
            </Field>
            <Field label="Writing preferences" hint="Tone, language, things to always or never say.">
              <Textarea
                name="style"
                rows={3}
                defaultValue={profile.style}
                placeholder="Warm but brief. Reply in Spanish to Spanish speakers. Never promise dates without checking."
              />
            </Field>
            <div className="flex md:justify-end">
              <SubmitButton className="w-full md:w-auto" pendingLabel="Saving…">
                Save
              </SubmitButton>
            </div>
          </form>
        </Card>

        <Card title="Autopilot" description="Claude prepares replies and follow-ups every day. They wait in Approvals — nothing is sent without you.">
          <form action={saveAutopilot} className="flex flex-col gap-3">
            <label className="flex min-h-11 items-center gap-3 text-[15px] md:min-h-0 md:text-sm">
              <Checkbox name="enabled" defaultChecked={autopilot.enabled} /> Prepare drafts automatically every day
            </label>
            <fieldset className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3">
              <legend className="sr-only">What to prepare</legend>
              <label className="flex min-h-10 items-center gap-3 text-sm md:min-h-0">
                <Checkbox name="needsReply" defaultChecked={autopilot.needsReply} /> Replies to people waiting for you
              </label>
              <label className="flex min-h-10 items-center gap-3 text-sm md:min-h-0">
                <Checkbox name="followUpsDue" defaultChecked={autopilot.followUpsDue} /> Follow-ups that are due
              </label>
              <label className="flex min-h-10 items-center gap-3 text-sm md:min-h-0">
                <Checkbox name="awaitingReply" defaultChecked={autopilot.awaitingReply} /> Nudges when nobody answered
              </label>
            </fieldset>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nudge after (days)">
                <Input name="awaitingDays" type="number" min={2} max={60} defaultValue={autopilot.awaitingDays} />
              </Field>
              <Field label="Max drafts per day">
                <Input name="maxPerRun" type="number" min={1} max={30} defaultValue={autopilot.maxPerRun} />
              </Field>
            </div>
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <p className="text-xs text-subtle">
                {autopilot.lastRunAt ? `Last run ${formatRelative(new Date(autopilot.lastRunAt), timezone)}` : "Has not run yet"}
              </p>
              <SubmitButton className="w-full md:w-auto" pendingLabel="Saving…">
                Save
              </SubmitButton>
            </div>
          </form>
        </Card>

        <Card title="About">
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex flex-col gap-1">
              <dt className="text-muted">Database</dt>
              <dd className="flex flex-col gap-1">
                <span>
                  {size.mb} MB of {env.dbSizeLimitMb} MB import limit
                </span>
                <span className="block h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-surface-2">
                  <span className={cn("block h-full rounded-full", sizePercent > 85 ? "bg-danger" : "bg-accent")} style={{ width: `${sizePercent}%` }} />
                </span>
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Live Gmail sync (Pub/Sub)</dt>
              <dd>{env.pubsubTopic ? "Configured" : "Not configured"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Timezone</dt>
              <dd>{timezone}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Claude model</dt>
              <dd>{env.anthropicModel}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">MCP endpoint</dt>
              <dd className="min-w-0 truncate">{env.mcpApiKey ? `${env.appUrl}/api/mcp` : "Off (set MCP_API_KEY)"}</dd>
            </div>
          </dl>
        </Card>
      </div>
    </>
  );
}

