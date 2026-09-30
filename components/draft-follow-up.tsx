"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { draftWithClaude } from "@/lib/ai/actions";

/**
 * "Draft with Claude" on the contact page: Claude writes the next email from
 * the history with this person (optionally steered by a note) and puts it in
 * the approval queue; the owner lands on the review screen to approve it.
 */
export function DraftFollowUp(props: {
  contactId: string;
  /** Connected accounts that can save drafts. */
  accounts: { id: string; email: string }[];
  /** Whether the contact has any email address / history. */
  hasEmail: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!props.hasEmail || props.accounts.length === 0) {
    return (
      <Button variant="secondary" disabled title={props.accounts.length ? "This contact has no email address" : "Connect a Gmail account first"}>
        <Sparkles className="size-4" /> Draft with Claude
      </Button>
    );
  }

  const generate = () =>
    startTransition(async () => {
      setError(null);
      const result = await draftWithClaude(props.contactId, instructions);
      if (result.ok && result.draftId) router.push(`/approvals/${result.draftId}`);
      else if (!result.ok) setError(result.error);
    });

  if (!open) {
    return (
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Sparkles className="size-4" /> Draft with Claude
      </Button>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2 rounded-xl border border-border bg-surface p-3 md:w-80 md:rounded-lg">
      <label htmlFor="draft-instructions" className="text-xs font-medium text-muted">
        What should the email say? <span className="text-subtle">(optional)</span>
      </label>
      <Textarea
        id="draft-instructions"
        rows={3}
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        placeholder="Follow up on the October dates, confirm the fee…"
        disabled={pending}
        autoFocus
      />
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
        <Button variant="primary" onClick={generate} disabled={pending}>
          {pending ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Writing…
            </>
          ) : (
            "Write draft"
          )}
        </Button>
      </div>
      <p className="text-xs text-subtle">Nothing is sent until you approve it.</p>
    </div>
  );
}
