"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useState, useTransition } from "react";
import { ArrowRight, Inbox, Layers, PenLine } from "lucide-react";
import { setImportanceAction } from "@/app/(app)/mail/actions";
import { CampaignPill, type CampaignRef } from "@/components/campaign-pill";
import { useMail } from "./mail-provider";

/**
 * Under a conversation's subject: the campaigns it belongs to, where Vela's
 * triage put it and why with a one-tap correction (Vela then remembers the
 * sender), and the reply Claude prepared, if there is one.
 */
export function TriageBar({
  accountId,
  threadId,
  triage,
  draftId,
  readOnly,
  campaigns = [],
}: {
  campaigns?: CampaignRef[];
  accountId: string;
  threadId: string;
  triage: { important: boolean; reason: string | null } | null;
  draftId: string | null;
  readOnly: boolean;
}) {
  const router = useRouter();
  const { toast } = useMail();
  const [important, setImportant] = useState(triage?.important ?? null);
  const [pending, start] = useTransition();
  if (important === null && !draftId && !campaigns.length) return null;

  const move = (next: boolean) =>
    start(async () => {
      setImportant(next);
      const result = await setImportanceAction(accountId, threadId, next);
      if (!result.ok) {
        setImportant(!next);
        toast({ tone: "error", message: result.error });
        return;
      }
      toast({ message: next ? "Moved to Important. Vela will keep this sender's emails there." : "Moved to Other. Vela will file this sender's emails there." });
      startTransition(() => router.refresh());
    });

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] md:text-xs">
      {campaigns.map((c) => (
        <CampaignPill key={c.id} campaign={c} link size="md" />
      ))}
      {important !== null ? (
        <span className="inline-flex min-w-0 items-center gap-1.5 text-muted">
          {important ? <Inbox className="size-3.5 shrink-0" /> : <Layers className="size-3.5 shrink-0" />}
          <span className="font-medium text-fg/80">{important ? "Important" : "Other"}</span>
          {triage?.reason && important === triage.important ? <span className="truncate">· {triage.reason}</span> : null}
          {!readOnly ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => move(!important)}
              className="ml-1 rounded-md px-1.5 py-0.5 font-medium text-blue-600 hover:bg-surface-2 disabled:opacity-50 dark:text-blue-400"
            >
              {important ? "Move to Other" : "Mark important"}
            </button>
          ) : null}
        </span>
      ) : null}
      {draftId ? (
        <Link
          href={`/approvals/${draftId}`}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-2 py-1 font-semibold text-blue-700 hover:opacity-80 dark:bg-blue-950 dark:text-blue-300"
        >
          <PenLine className="size-3.5" />
          Claude prepared a reply
          <ArrowRight className="size-3.5" />
        </Link>
      ) : null}
    </div>
  );
}
