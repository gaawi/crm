"use server";

import { requireSession } from "@/lib/auth";
import { cardInfo, draftThread, type CardInfo, type DraftThread } from "@/lib/approvals/card-data";

export type { CardInfo, DraftThread, ThreadMessage } from "@/lib/approvals/card-data";

/**
 * Server actions for the back and the conversation of an approval card. The
 * flashcards read them through /api/approvals/card instead (route handlers run
 * in parallel; server actions wait in line behind a send).
 */
export async function loadCardInfo(draftId: string): Promise<{ ok: true; info: CardInfo } | { ok: false; error: string }> {
  await requireSession();
  return cardInfo(draftId);
}

export async function loadDraftThread(draftId: string): Promise<{ ok: true; thread: DraftThread } | { ok: false; error: string }> {
  await requireSession();
  return draftThread(draftId);
}
