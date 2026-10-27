import "server-only";
import type { MailingCardData } from "@/components/approvals/mailing-card";
import { listCampaignSummaries } from "@/lib/campaigns/campaigns";
import { isHeldBack, planSentence } from "@/lib/campaigns/format";
import { sql } from "@/lib/db";
import { releasePostponed } from "@/lib/queries/assistant";
import { listDrafts, recoverStaleDrafts } from "@/lib/queries/drafts";
import type { EmailDraft } from "@/lib/types";

/**
 * Everything waiting for the owner's approval: single emails (Claude's,
 * the autopilot's, the campaign assistant's, templates) and mailings (bulk
 * sends of a campaign, approved as a whole). Today shows the count; the
 * flashcards (/approvals/review) go through them one by one.
 */
export interface PendingApprovals {
  drafts: EmailDraft[];
  mailings: MailingCardData[];
  /** Emails the owner sent back with a note, waiting for the assistant's new version. */
  waitingVersion: number;
  /** Cards to review: emails + mailings. */
  total: number;
}

/** The "?sheet=" of the emails that belong to no booking sheet. */
export const OTHER_SHEET = "other";

/**
 * Single emails in piles by booking sheet (the campaign they are for), the
 * biggest first and "Other" (no sheet) last.
 */
export function draftsBySheet(drafts: EmailDraft[]) {
  const piles = new Map<string, { key: string; name: string; drafts: EmailDraft[] }>();
  for (const d of drafts) {
    const key = d.campaign?.id ?? OTHER_SHEET;
    const pile = piles.get(key) ?? { key, name: d.campaign?.name ?? "Other", drafts: [] };
    pile.drafts.push(d);
    piles.set(key, pile);
  }
  return [...piles.values()]
    .sort((a, b) => Number(a.key === OTHER_SHEET) - Number(b.key === OTHER_SHEET) || b.drafts.length - a.drafts.length)
    .map((p) => ({ ...p, faces: p.drafts.flatMap((d) => (d.contact ? [d.contact] : [])).slice(0, 5) }));
}

export async function loadPendingApprovals(now: Date = new Date(), options: { details?: boolean } = {}): Promise<PendingApprovals> {
  await recoverStaleDrafts();
  // Postponed emails whose day has come are back in the pile.
  await releasePostponed();
  const [open, campaigns, waiting] = await Promise.all([
    listDrafts(),
    listCampaignSummaries({}, now),
    sql<{ n: number }[]>`select count(*)::int as n from email_drafts where status = 'changes_requested'`,
  ]);
  const drafts = open.filter((d) => d.status === "proposed" || d.status === "failed");
  // Waiting for approval: prepared, or cancelled / done with emails left to approve.
  const waitingMailings = campaigns.filter((c) => c.status !== "running" && c.status !== "paused" && c.remaining > 0);

  let mailings: MailingCardData[] = waitingMailings.map((c) => ({
    id: c.id,
    name: c.name,
    projectName: c.projectName,
    accountEmail: c.accountEmail,
    accountOk: c.accountStatus === "active",
    count: c.remaining,
    held: c.heldBack,
    plan: planSentence({ count: c.remaining, accountEmail: c.accountEmail, settings: c, next: null, finish: null, now }),
    recipients: [],
    sample: null,
  }));

  if (options.details && mailings.length) {
    const ids = mailings.map((m) => m.id);
    const [monitor, perMailing] = await Promise.all([
      sql<{ id: string }[]>`
        select c.id from email_campaigns c join gmail_accounts a on a.id = c.account_id
         where c.id = any(${ids}::uuid[]) and a.monitor_only`,
      Promise.all(ids.map((id) => listDrafts({ campaign: id }))),
    ]);
    const blocked = new Set(monitor.map((r) => r.id));
    mailings = mailings.map((m, i) => {
      const toSend = perMailing[i].filter((d) => (d.status === "proposed" || d.status === "failed") && !isHeldBack(d));
      const first = toSend[0];
      return {
        ...m,
        accountOk: m.accountOk && !blocked.has(m.id),
        recipients: toSend.map((d) => ({
          contactId: d.contact?.id ?? null,
          name: d.contact?.displayName ?? d.to[0] ?? "?",
          org: d.organization?.name ?? null,
          photoUrl: d.contact?.photoUrl ?? null,
          to: d.to.join(", "),
          subject: d.subject,
        })),
        sample: first ? { to: first.to.join(", "), subject: first.subject, body: first.body } : null,
      };
    });
  }

  return { drafts, mailings, waitingVersion: waiting[0]?.n ?? 0, total: drafts.length + mailings.length };
}
