"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { deleteRowAction, updateCellAction, type SheetField } from "../actions";

const base =
  "w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1.5 text-[15px] text-fg outline-none transition-colors hover:border-border focus:border-border-strong focus:bg-bg md:py-1 md:text-sm";

function useCell(rowId: string, name: SheetField) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const save = (value: string) =>
    start(async () => {
      const result = await updateCellAction(rowId, name, value).catch(() => ({ ok: false, error: "Not saved. Try again." }));
      setError(result.ok ? null : (result.error ?? "Not saved."));
    });
  return { pending, error, save };
}

function Status({ pending, error }: { pending: boolean; error: string | null }) {
  if (error) return <span className="mt-0.5 block px-2 text-xs text-danger">{error}</span>;
  if (pending) return <span className="mt-0.5 block px-2 text-xs text-subtle">Saving…</span>;
  return null;
}

/** Text cell: saves on blur or Enter when the value changed. */
export function TextCell({
  rowId,
  name,
  value,
  placeholder,
  label,
  multiline = false,
  rows = 2,
}: {
  rowId: string;
  name: SheetField;
  value: string | null;
  placeholder?: string;
  label: string;
  multiline?: boolean;
  rows?: number;
}) {
  const { pending, error, save } = useCell(rowId, name);
  const [initial, setInitial] = useState(value ?? "");
  const commit = (next: string) => {
    if (next.trim() === initial.trim()) return;
    setInitial(next);
    save(next);
  };
  return (
    <div>
      {multiline ? (
        <textarea
          defaultValue={value ?? ""}
          aria-label={label}
          placeholder={placeholder}
          rows={rows}
          onBlur={(e) => commit(e.currentTarget.value)}
          className={cn(base, "resize-y leading-snug", error && "border-danger")}
        />
      ) : (
        <input
          defaultValue={value ?? ""}
          aria-label={label}
          placeholder={placeholder}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className={cn(base, error && "border-danger")}
        />
      )}
      <Status pending={pending} error={error} />
    </div>
  );
}

export function StageCell({ rowId, value, options }: { rowId: string; value: string; options: { value: string; label: string }[] }) {
  const { pending, error, save } = useCell(rowId, "stage");
  return (
    <div>
      <select
        defaultValue={value}
        aria-label="Status"
        onChange={(e) => save(e.currentTarget.value)}
        className={cn(base, "cursor-pointer appearance-auto pr-1 font-medium", error && "border-danger")}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Status pending={pending} error={error} />
    </div>
  );
}

export function DateCell({ rowId, value, overdue }: { rowId: string; value: string | null; overdue: boolean }) {
  const { pending, error, save } = useCell(rowId, "followUpAt");
  return (
    <div>
      <input
        type="date"
        defaultValue={value ?? ""}
        aria-label="Follow-up date"
        onChange={(e) => save(e.currentTarget.value)}
        className={cn(base, overdue && "font-medium text-danger", error && "border-danger")}
      />
      <Status pending={pending} error={error} />
    </div>
  );
}

export function DeleteRowButton({ rowId, name }: { rowId: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={`Remove ${name} from this sheet`}
      title="Remove from this sheet"
      onClick={() => {
        if (window.confirm(`Remove ${name} from this sheet? The organization, contact and emails stay in the CRM.`)) {
          start(() => deleteRowAction(rowId));
        }
      }}
      className="flex size-11 items-center justify-center rounded-md text-subtle hover:bg-surface-2 hover:text-danger disabled:opacity-50 md:size-8"
    >
      <Trash2 className="size-4" strokeWidth={1.75} />
    </button>
  );
}
