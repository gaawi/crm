import "server-only";
import { runAutoReplies, type AutoReplyResult } from "@/lib/ai/auto-reply";
import { runTriage, type TriageRunResult } from "@/lib/mail/triage";

/**
 * After new mail is stored: sort it (Important / Other) and prepare replies
 * for the important emails that need one. Runs after every sync (Gmail push,
 * sync-on-visit, the cron); cheap when there is nothing new. Never throws.
 */
export async function runInboxAssistant(options: { deadline: number }): Promise<{ triage: TriageRunResult; replies: AutoReplyResult }> {
  const triage = await runTriage({ deadline: options.deadline });
  const replies = await runAutoReplies({ deadline: options.deadline });
  return { triage, replies };
}
