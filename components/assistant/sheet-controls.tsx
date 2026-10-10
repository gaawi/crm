"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/layout";
import { saveAssistantBriefAction, setAssistantActiveAction } from "@/lib/assistant/actions";
import { cn } from "@/lib/utils";

/** Booking sheet header: the assistant's Active / Paused switch (44pt on phones). */
export function AssistantSwitch({ projectId, active }: { projectId: string; active: boolean }) {
  const [on, setOn] = useState(active);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toggle = () =>
    start(async () => {
      const next = !on;
      setOn(next);
      const result = await setAssistantActiveAction(projectId, next);
      if (!result.ok) {
        setOn(!next);
        setError(result.error);
      } else setError(null);
    });
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Daily assistant"
      title={error ?? (on ? "The assistant reviews this campaign every day. Tap to pause." : "Paused. Tap to let the assistant review this campaign every day.")}
      onClick={toggle}
      disabled={pending}
      className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[15px] font-medium active:opacity-70 md:h-8 md:rounded-md md:px-2.5 md:text-sm md:hover:bg-surface-2"
    >
      <span className={cn("relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors", on ? "bg-emerald-500" : "bg-border")} aria-hidden>
        <span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform", on ? "translate-x-[18px]" : "translate-x-0.5")} />
      </span>
      <span className="whitespace-nowrap">
        <span className="hidden md:inline">Assistant </span>
        {on ? "Active" : "Paused"}
      </span>
    </button>
  );
}

/** "What should the assistant aim for in this campaign?" */
export function BriefEditor({ projectId, brief }: { projectId: string; brief: string | null }) {
  const [value, setValue] = useState(brief ?? "");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = value.trim() !== (brief ?? "").trim();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveAssistantBriefAction(projectId, value);
          setResult(r.ok ? { ok: true, text: "Saved. The assistant uses it from its next review." } : { ok: false, text: r.error });
        });
      }}
    >
      <label htmlFor={`brief-${projectId}`} className="text-sm font-medium">
        What should the assistant aim for in this campaign?
      </label>
      <Textarea
        id={`brief-${projectId}`}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setResult(null);
        }}
        rows={4}
        maxLength={5000}
        placeholder="e.g. Book 8–10 dates in October–November 2027 in theatres of 300+ seats. Friendly, short emails in Spanish. Follow up after 10 days without reply; call before a third email."
      />
      <div className="flex items-center gap-2">
        {result ? <span className={cn("text-sm", result.ok ? "text-muted" : "text-danger")}>{result.text}</span> : null}
        <Button type="submit" variant="primary" className="ml-auto" disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save brief"}
        </Button>
      </div>
      {!value.trim() && !brief ? <Notice>Without a brief the assistant follows the sheet: stages, next steps and replies.</Notice> : null}
    </form>
  );
}
