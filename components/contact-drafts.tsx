"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CornerDownRight, Loader2, Send, Sparkles, Trash2 } from "lucide-react";
import { approveDraftAction, discardDraftAction, saveDraftEditsAction } from "@/lib/ai/actions";
import type { EmailDraft } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EditableEmail } from "./approvals/thread-face";

/**
 * At the bottom of a contact's history: the emails to them still waiting in
 * Today, set apart in blue, to edit right there and send (or discard) without
 * going to Today. The same draft as on Today's cards.
 */
export function ContactDrafts({ drafts }: { drafts: EmailDraft[] }) {
  if (!drafts.length) return null;
  return (
    <div className="mt-3 flex flex-col gap-3">
      {drafts.map((d) => (
        <ContactDraft key={d.id} draft={d} />
      ))}
    </div>
  );
}

function ContactDraft({ draft }: { draft: EmailDraft }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [armed, setArmed] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const typed = useRef<{ subject: string; body: string } | null>(null);
  const reason = draft.assistantReason ?? draft.rationale;

  const save = async () => {
    const e = typed.current;
    if (!e) return { ok: true as const };
    const form = new FormData();
    form.set("to", draft.to.join(", "));
    form.set("cc", draft.cc.join(", "));
    form.set("subject", e.subject);
    form.set("body", e.body);
    const r = await saveDraftEditsAction(draft.id, form);
    if (r.ok && typed.current === e) typed.current = null;
    return r;
  };
  const act = (run: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    start(async () => {
      const r = await run().catch(() => ({ ok: false, error: "Something went wrong. Try again." }));
      setArmed(false);
      if (!r.ok) return setMessage({ tone: "error", text: r.error ?? "Something went wrong. Try again." });
      setMessage({ tone: "ok", text: done });
      router.refresh();
    });

  return (
    <section aria-label="Draft to approve" className="rounded-xl border-2 border-brand bg-brand/[0.04] px-3 py-2.5 md:px-4">
      <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-brand">
        <CornerDownRight className="size-3.5" aria-hidden />
        {draft.replyToMessageId ? "Draft reply" : "Draft"} · not sent yet ·{" "}
        {draft.status === "postponed" && draft.postponedUntil
          ? `postponed, back in Today ${new Date(`${draft.postponedUntil}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`
          : "waiting in Today"}
      </p>
      {reason ? (
        <p className="mt-1.5 rounded-md bg-surface-2 px-2.5 py-1.5 text-[12px] leading-snug text-muted">
          <Sparkles className="mr-1 inline size-3 align-[-1px]" aria-hidden />
          {reason}
        </p>
      ) : null}
      {draft.error ? <p className="mt-1.5 rounded-md bg-warning/10 px-2.5 py-1.5 text-[12px] text-warning">{draft.error}</p> : null}
      <p className="mt-1.5 text-[11.5px] leading-snug text-subtle">
        From {draft.accountEmail} · To {draft.to.join(", ")}
        {draft.cc.length ? ` · Cc ${draft.cc.join(", ")}` : ""}
      </p>
      <EditableEmail
        draft={draft}
        onEdit={(fields) => (typed.current = fields)}
        onEditEnd={() =>
          void save().then((r) => {
            if (!r.ok) setMessage({ tone: "error", text: ("error" in r && r.error) || "Not saved. Try again." });
          })
        }
      />
      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => act(() => discardDraftAction(draft.id), "Discarded.")}
          className="inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-[14px] text-danger active:bg-surface-2 disabled:opacity-50 md:h-8 md:text-[13px] md:hover:bg-surface-2"
        >
          <Trash2 className="size-4" aria-hidden />
          Discard
        </button>
        {message ? (
          <p className={cn("min-w-0 flex-1 truncate text-[12px]", message.tone === "error" ? "text-danger" : "text-success")}>{message.text}</p>
        ) : (
          <span className="flex-1" />
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!armed) return setArmed(true);
            act(async () => {
              // What was typed here goes out, not the earlier version.
              const saved = await save();
              return saved.ok ? approveDraftAction(draft.id) : saved;
            }, "Sent.");
          }}
          className={cn(
            "inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[15px] font-semibold text-white active:opacity-90 disabled:opacity-60 md:h-9 md:text-sm",
            armed ? "bg-success" : "bg-brand",
          )}
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : armed ? <Check className="size-4" /> : <Send className="size-4" />}
          {armed ? "Tap again to send" : "Approve & send"}
        </button>
      </div>
    </section>
  );
}
