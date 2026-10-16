"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { MAX_AUTO_REPLIES_PER_DAY, MAX_DAILY_EMAILS, saveSettings } from "@/lib/queries/settings";
import { deleteAccount, disconnectAccount } from "@/lib/sync/accounts";
import { resetBackfill, startOlderHistoryImport } from "@/lib/sync/backfill";
import { triggerAccountJob } from "@/lib/sync/runner";
import { errorMessage } from "@/lib/utils";

const uuid = z.string().regex(/^[0-9a-f-]{36}$/i);

function accountId(value: string): string {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw new Error("Invalid account");
  return parsed.data;
}

async function importUnfinished(id: string): Promise<boolean> {
  const [row] = await sql<{ unfinished: boolean }[]>`
    select backfill_status <> 'done' as unfinished from gmail_accounts where id = ${id} and status = 'active'`;
  return Boolean(row?.unfinished);
}

/** Sync new mail now (and continue the import if it is unfinished). */
export async function syncNow(id: string): Promise<void> {
  await requireSession();
  const account = accountId(id);
  await triggerAccountJob(account, "sync");
  if (await importUnfinished(account)) await triggerAccountJob(account, "backfill");
  refresh();
}

/** Continue a paused/stalled import (also called periodically while Settings is open). */
export async function resumeImport(id: string): Promise<void> {
  await requireSession();
  const account = accountId(id);
  await sql`
    update gmail_accounts set backfill_status = 'pending'
     where id = ${account} and backfill_status = 'error'`;
  await triggerAccountJob(account, "backfill");
  refresh();
}

export async function restartImport(id: string): Promise<void> {
  await requireSession();
  const account = accountId(id);
  await resetBackfill(account);
  await triggerAccountJob(account, "backfill");
  refresh();
}

/** Import the mail older than the oldest stored email (lean: real conversations only). */
export async function importOlderHistory(id: string): Promise<void> {
  await requireSession();
  const account = accountId(id);
  if (await startOlderHistoryImport(account)) await triggerAccountJob(account, "backfill");
  refresh();
}

export async function disconnect(id: string): Promise<void> {
  await requireSession();
  await disconnectAccount(accountId(id));
  redirect("/settings");
}

export async function removeAccount(id: string, formData: FormData): Promise<void> {
  await requireSession();
  if (formData.get("confirm") !== "yes") redirect(`/settings?remove=${id}&error=confirm`);
  await deleteAccount(accountId(id));
  redirect("/settings");
}

export async function setDefaultProject(id: string, formData: FormData): Promise<void> {
  await requireSession();
  const projectId = String(formData.get("projectId") ?? "");
  await sql`
    update gmail_accounts set default_project_id = ${uuid.safeParse(projectId).success ? projectId : null}
     where id = ${accountId(id)}`;
  refresh();
}

/**
 * Monitor only: Vela keeps importing the mailbox but never changes anything in
 * it (no read marks, archive, labels, drafts or sending). Turning it on also
 * stops the campaigns (projects) that would send from it.
 */
export async function setMonitorOnly(id: string, on: boolean): Promise<void> {
  await requireSession();
  const accountIdValue = accountId(id);
  await sql.begin(async (tx) => {
    await tx`update gmail_accounts set monitor_only = ${on} where id = ${accountIdValue}`;
    if (on) await tx`update projects set send_account_id = null where send_account_id = ${accountIdValue}`;
  });
  refresh();
}

export async function saveProfile(formData: FormData): Promise<void> {
  await requireSession();
  await saveSettings("profile", {
    name: String(formData.get("name") ?? "")
      .trim()
      .slice(0, 100),
    signature: String(formData.get("signature") ?? "")
      .trim()
      .slice(0, 1000),
    style: String(formData.get("style") ?? "")
      .trim()
      .slice(0, 1000),
  });
  redirect("/settings?saved=profile");
}

export async function saveAutopilot(formData: FormData): Promise<void> {
  await requireSession();
  const number = (name: string, fallback: number, min: number, max: number) => {
    const value = Number(formData.get(name));
    return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
  };
  try {
    await saveSettings("autopilot", {
      enabled: formData.get("enabled") === "on",
      needsReply: formData.get("needsReply") === "on",
      followUpsDue: formData.get("followUpsDue") === "on",
      awaitingReply: formData.get("awaitingReply") === "on",
      awaitingDays: number("awaitingDays", 7, 2, 60),
      maxPerRun: number("maxPerRun", 8, 1, 30),
    });
  } catch (error) {
    console.error("Saving autopilot settings failed:", errorMessage(error));
    redirect("/settings?error=autopilot");
  }
  redirect("/settings?saved=autopilot");
}

/** Smart inbox: automatic reply drafts on or off, and how many per day. */
export async function saveInbox(formData: FormData): Promise<void> {
  await requireSession();
  const value = Number(formData.get("autoRepliesPerDay"));
  try {
    await saveSettings("inbox", {
      autoReplies: formData.get("autoReplies") === "on",
      autoRepliesPerDay: Number.isFinite(value) ? Math.min(MAX_AUTO_REPLIES_PER_DAY, Math.max(1, Math.round(value))) : 15,
    });
  } catch (error) {
    console.error("Saving inbox settings failed:", errorMessage(error));
    redirect("/settings?error=inbox");
  }
  redirect("/settings?saved=inbox");
}

export async function saveAssistant(formData: FormData): Promise<void> {
  await requireSession();
  const value = Number(formData.get("dailyEmails"));
  try {
    await saveSettings("assistant", {
      dailyEmails: Number.isFinite(value) ? Math.min(MAX_DAILY_EMAILS, Math.max(1, Math.round(value))) : 10,
    });
  } catch (error) {
    console.error("Saving assistant settings failed:", errorMessage(error));
    redirect("/settings?error=assistant");
  }
  redirect("/settings?saved=assistant");
}
