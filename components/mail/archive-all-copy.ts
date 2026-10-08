import { TAB_TITLES, type InboxTab } from "@/lib/mail/params";

/** Wording of "Archive all" (the confirmation and the toast), kept pure for tests. */

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

export function conversations(n: number): string {
  return `${formatCount(n)} conversation${n === 1 ? "" : "s"}`;
}

/** "Inbox · Primary · all accounts"; `tab` null = every inbox tab. */
export function archiveScopeLabel(tab: InboxTab | null, accountLabel: string): string {
  return ["Inbox", tab ? TAB_TITLES[tab] : "all tabs", accountLabel].join(" · ");
}

/** The confirmation's question; `count` null while it is being counted. */
export function archiveQuestion(count: number | null, scope: string): string {
  if (count === null) return `Archive all conversations in ${scope}? They stay in All Mail and search.`;
  if (count === 1) return `Archive the 1 conversation in ${scope}? It stays in All Mail and search.`;
  return `Archive all ${formatCount(count)} conversations in ${scope}? They stay in All Mail and search.`;
}

function sentence(text: string): string {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/** The toast after archiveAllAction succeeded. */
export function archivedMessage(result: { archived: number; more: boolean; warnings: string[] }): string {
  const parts: string[] = [];
  if (result.archived === 0 && !result.more) {
    parts.push(result.warnings.length ? "Nothing was archived." : "Nothing to archive: the inbox was already empty.");
  } else {
    parts.push(`${conversations(result.archived)} archived.`);
  }
  if (result.more) parts.push("More are still in the inbox: choose Archive all again to continue.");
  if (result.warnings.length === 1) parts.push(sentence(result.warnings[0]));
  else if (result.warnings.length > 1) parts.push(`${result.warnings.length} accounts were left out: ${result.warnings.map((w) => w.trim().replace(/\.$/, "")).join("; ")}.`);
  return parts.join(" ");
}
