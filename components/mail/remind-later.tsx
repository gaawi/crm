"use client";

import { useState, useTransition } from "react";
import { BellPlus } from "lucide-react";
import { scheduleFollowUp } from "@/app/(app)/contacts/[id]/actions";
import { cn } from "@/lib/utils";

/** The first weekday of the month (a Saturday or Sunday 1st moves to Monday). */
function firstWeekday(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month, 1));
  const shift = d.getUTCDay() === 6 ? 2 : d.getUTCDay() === 0 ? 1 : 0;
  d.setUTCDate(1 + shift);
  return d.toISOString().slice(0, 10);
}

const monthShort = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });

/**
 * "They said: write to us in February." One tap on the month (or an exact
 * day), a few words on what to send, and the reminder is in Today →
 * Scheduled until that day, then in "Follow up today".
 */
export function RemindLater({ contactId, today, onSaved }: { contactId: string; today: string; onSaved?: () => void }) {
  const [y, m] = today.split("-").map(Number);
  const months = Array.from({ length: 6 }, (_, i) => {
    const date = firstWeekday(y, m + i); // m is 1-based: m + 0 = next month
    const label = monthShort.format(new Date(`${date}T12:00:00Z`)) + (Number(date.slice(0, 4)) !== y ? ` ’${date.slice(2, 4)}` : "");
    return { date, label };
  });
  const [date, setDate] = useState<string>("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      const result = await scheduleFollowUp(contactId, date, note);
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setMessage({ tone: "ok", text: "Reminder saved: it is in Today → Scheduled." });
      setDate("");
      setNote("");
      onSaved?.();
    });

  return (
    <div className="flex flex-col gap-2 border-t border-border px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-fg/80 md:text-xs">
        <BellPlus className="size-3.5" aria-hidden /> Remind me in…
      </p>
      <div className="grid grid-cols-6 gap-1">
        {months.map((option) => (
          <button
            key={option.date}
            type="button"
            onClick={() => setDate(option.date)}
            aria-pressed={date === option.date}
            className={cn(
              "h-9 rounded-md border text-[13px] font-medium md:h-7 md:text-xs",
              date === option.date ? "border-brand bg-brand text-white" : "border-border bg-surface text-fg/80 hover:bg-surface-2",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input
          type="date"
          value={date}
          min={today}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Exact day"
          className="h-9 w-[9.5rem] shrink-0 rounded-md border border-border bg-bg px-2 text-[13px] md:h-8 md:text-xs"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What to send (e.g. 2028–29 dates)"
          maxLength={300}
          className="h-9 min-w-0 flex-1 rounded-md border border-border bg-bg px-2 text-[13px] md:h-8 md:text-xs"
        />
      </div>
      <button
        type="button"
        disabled={!date || pending}
        onClick={save}
        className="h-9 rounded-md bg-brand text-[13px] font-semibold text-white disabled:opacity-40 md:h-8 md:text-xs"
      >
        {pending ? "Saving…" : date ? `Remind me on ${new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}` : "Pick a month or a day"}
      </button>
      {message ? <p className={cn("text-[13px] md:text-xs", message.tone === "error" ? "text-danger" : "text-success")}>{message.text}</p> : null}
    </div>
  );
}
