"use client";

import { useState, useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { prepareDraftsNow } from "@/lib/ai/actions";

/** Runs the autopilot once: Claude prepares replies/follow-ups for everyone waiting. */
export function PrepareDraftsButton() {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col items-stretch gap-1 md:items-end">
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await prepareDraftsNow();
            setMessage(result.ok ? { ok: true, text: result.message ?? "Done" } : { ok: false, text: result.error });
          })
        }
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        {pending ? "Claude is writing…" : "Prepare drafts"}
      </Button>
      {message ? <p className={message.ok ? "text-xs text-success" : "text-xs text-danger"}>{message.text}</p> : null}
    </div>
  );
}
