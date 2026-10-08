"use client";

import { useId, useRef, useState, useTransition } from "react";
import { Target, Trash2 } from "lucide-react";
import { emitActivityChanged } from "@/components/booking/activity-events";
import { GoalKindOptions, NextActionIcon, NextActionOptions } from "@/components/goals";
import { Checkbox } from "@/components/ui/field";
import { GOAL_KINDS, goalLabel, nextActionLabel } from "@/lib/constants";
import type { NextAction, OpportunityKind } from "@/lib/types";
import { cn } from "@/lib/utils";
import { deleteRowAction, updateCellAction, type SheetField } from "../actions";

/**
 * Inline-editable cells of a booking row. Each saves itself through
 * updateCellAction (which calls refresh()), and follows the server's value
 * when it changes elsewhere (the log-call dialog setting a follow-up, a bulk
 * status change), so the table, the phone cards and the History drawer never
 * show stale values.
 *
 * `look`: "cell" = borderless until hovered (desktop table), "field" =
 * a regular bordered form control (phone cards, the drawer).
 */
export type CellLook = "cell" | "field";

const cellClass =
  "w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1.5 text-[15px] outline-none transition-colors placeholder:text-subtle hover:border-border focus:border-border-strong focus:bg-bg md:py-1 md:text-sm";

/** Same metrics as components/ui/field (16px on phones so iOS never zooms). */
const fieldClass =
  "w-full min-w-0 rounded-lg border border-border bg-surface px-3 text-base placeholder:text-subtle focus:border-border-strong focus:outline-none focus:ring-2 focus:ring-ring/30 md:rounded-md md:px-2.5 md:text-sm";

/**
 * `text` is the text color: passed in rather than overridden afterwards,
 * because `cn` only joins classes (text-fg would beat text-danger).
 */
function controlClass(look: CellLook, multiline = false, text = "text-fg") {
  if (look === "cell") return cn(cellClass, text);
  return cn(fieldClass, text, multiline ? "py-2 leading-relaxed md:py-1.5" : "h-11 md:h-8");
}

function useCell(rowId: string, name: SheetField, onSaved?: (value: string) => void) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const save = (value: string) =>
    start(async () => {
      const result = await updateCellAction(rowId, name, value).catch(() => ({ ok: false, error: "Not saved. Try again." }));
      setError(result.ok ? null : (result.error ?? "Not saved."));
      if (result.ok) onSaved?.(value);
    });
  return { pending, error, save };
}

/** Local draft that resets whenever the server's value changes. */
function useSynced(value: string) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }
  return [draft, setDraft] as const;
}

function Status({ pending, error, look }: { pending: boolean; error: string | null; look: CellLook }) {
  const pad = look === "cell" ? "px-2" : "px-1";
  if (error) return <span className={cn("mt-0.5 block text-xs text-danger", pad)}>{error}</span>;
  if (pending) return <span className={cn("mt-0.5 block text-xs text-subtle", pad)}>Saving…</span>;
  return null;
}

/** Text cell: saves on blur or Enter (single line) when the value changed. */
export function TextCell({
  rowId,
  name,
  value,
  placeholder,
  label,
  multiline = false,
  rows = 2,
  look = "cell",
  list,
  inputMode,
  type = "text",
  className,
}: {
  rowId: string;
  name: SheetField;
  value: string | null;
  placeholder?: string;
  label: string;
  multiline?: boolean;
  rows?: number;
  look?: CellLook;
  /** id of a <datalist> with suggestions (sections). */
  list?: string;
  inputMode?: "text" | "tel" | "decimal" | "email";
  type?: "text" | "tel";
  className?: string;
}) {
  const { pending, error, save } = useCell(rowId, name);
  const [draft, setDraft] = useSynced(value ?? "");
  // What was last sent, so a second blur before the refresh lands does not save again.
  const sent = useRef(value ?? "");
  const commit = () => {
    const next = draft.trim();
    if (next === (value ?? "").trim() || (!error && next === sent.current.trim())) return;
    sent.current = next;
    save(next);
  };
  const common = {
    value: draft,
    "aria-label": label,
    "aria-invalid": error ? true : undefined,
    placeholder,
    onChange: (e: { currentTarget: { value: string } }) => setDraft(e.currentTarget.value),
    onBlur: commit,
  };
  return (
    <div className={className}>
      {multiline ? (
        <textarea {...common} rows={rows} className={cn(controlClass(look, true), "resize-y leading-snug", error && "border-danger")} />
      ) : (
        <input
          {...common}
          type={type}
          list={list}
          inputMode={inputMode}
          autoComplete="off"
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(value ?? "");
              requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
            }
          }}
          className={cn(controlClass(look), error && "border-danger")}
        />
      )}
      <Status pending={pending} error={error} look={look} />
    </div>
  );
}

/**
 * Status select. A change is logged in the row's history on the server; the
 * activity-changed event makes an open History drawer show it right away.
 */
export function StageCell({
  rowId,
  value,
  options,
  look = "cell",
  className,
}: {
  rowId: string;
  value: string;
  options: { value: string; label: string }[];
  look?: CellLook;
  className?: string;
}) {
  const { pending, error, save } = useCell(rowId, "stage", () => emitActivityChanged({ opportunityId: rowId }));
  const [draft, setDraft] = useSynced(value);
  return (
    <div className={className}>
      <select
        value={draft}
        aria-label="Status"
        onChange={(e) => {
          setDraft(e.currentTarget.value);
          save(e.currentTarget.value);
        }}
        className={cn(controlClass(look), "cursor-pointer appearance-auto pr-1 font-medium", error && "border-danger")}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Status pending={pending} error={error} look={look} />
    </div>
  );
}

/**
 * Desktop table look of a select whose labels are long ("Keep informed of
 * our news"): the chosen label wraps instead of being cut, and the real
 * <select> sits invisibly on top (same picker, keyboard and screen reader).
 * Borderless until hovered, like the table's other cells.
 */
function WrappingSelect({
  icon,
  text,
  textClass,
  error,
  children,
  ...select
}: React.ComponentProps<"select"> & { icon: React.ReactNode; text: string; textClass: string; error: boolean }) {
  return (
    <div
      className={cn(
        "relative flex min-w-0 items-start gap-1.5 rounded-md border border-transparent px-2 transition-colors focus-within:border-border-strong focus-within:bg-bg hover:border-border",
        textClass,
        error && "border-danger",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 leading-snug [overflow-wrap:anywhere]">{text}</span>
      <select {...select} className="absolute inset-0 size-full cursor-pointer appearance-none opacity-0">
        {children}
      </select>
    </div>
  );
}

/**
 * The row's goal (what we want from them: get booked, use of a space…), as
 * a select grouped like GOAL_KINDS. "cell": a small muted line under the
 * status (desktop table); "field": a regular select. The status names follow
 * the goal, so an open History drawer reloads too.
 */
export function KindCell({
  rowId,
  value,
  look = "cell",
  className,
}: {
  rowId: string;
  value: OpportunityKind;
  look?: CellLook;
  className?: string;
}) {
  const { pending, error, save } = useCell(rowId, "kind", () => emitActivityChanged({ opportunityId: rowId }));
  const [draft, setDraft] = useSynced(value);
  const hint = GOAL_KINDS.find((k) => k.value === draft)?.hint;
  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.currentTarget.value as OpportunityKind;
    setDraft(next);
    save(next);
  };
  const title = hint ? `Goal: ${hint}` : "Goal";
  if (look === "cell") {
    return (
      <div className={className}>
        <WrappingSelect
          value={draft}
          aria-label="Goal"
          title={title}
          onChange={onChange}
          icon={<Target className="mt-[3px] size-3 shrink-0 text-subtle" strokeWidth={2} aria-hidden />}
          text={goalLabel(draft as OpportunityKind)}
          textClass="py-1 text-xs text-muted hover:text-fg"
          error={Boolean(error)}
        >
          <GoalKindOptions />
        </WrappingSelect>
        <Status pending={pending} error={error} look={look} />
      </div>
    );
  }
  return (
    <div className={className}>
      <div className="relative">
        <Target
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle md:left-2.5 md:size-3.5"
          strokeWidth={2}
          aria-hidden
        />
        <select
          value={draft}
          aria-label="Goal"
          title={title}
          onChange={onChange}
          className={cn(controlClass(look), "cursor-pointer appearance-auto pl-9 pr-1 md:pl-8", error && "border-danger")}
        >
          <GoalKindOptions />
        </select>
      </div>
      <Status pending={pending} error={error} look={look} />
    </div>
  );
}

/**
 * The structured next step (Call, Send full proposal, Keep informed…) with
 * its icon; "" = none. The free-text detail is a TextCell "nextStep" and the
 * due date the DateCell.
 */
export function NextActionCell({
  rowId,
  value,
  look = "cell",
  className,
}: {
  rowId: string;
  value: NextAction | null;
  look?: CellLook;
  className?: string;
}) {
  const { pending, error, save } = useCell(rowId, "nextAction");
  const [draft, setDraft] = useSynced(value ?? "");
  const action = (draft || null) as NextAction | null;
  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setDraft(e.currentTarget.value);
    save(e.currentTarget.value);
  };
  const options = (
    <>
      <option value="">No next step</option>
      <NextActionOptions />
    </>
  );
  if (look === "cell") {
    return (
      <div className={className}>
        <WrappingSelect
          value={draft}
          aria-label="Next step"
          title={nextActionLabel(action) ?? "Next step"}
          onChange={onChange}
          icon={action ? <NextActionIcon action={action} className="mt-[3px] text-fg/70" /> : null}
          text={nextActionLabel(action) ?? "No next step"}
          textClass={cn("py-1 text-[13px]", action ? "text-fg" : "text-subtle")}
          error={Boolean(error)}
        >
          {options}
        </WrappingSelect>
        <Status pending={pending} error={error} look={look} />
      </div>
    );
  }
  return (
    <div className={className}>
      <div className="relative">
        {action ? (
          <NextActionIcon
            action={action}
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg/70 md:left-2.5 md:size-3.5"
          />
        ) : null}
        <select
          value={draft}
          aria-label="Next step"
          onChange={onChange}
          className={cn(
            controlClass(look, false, action ? "text-fg" : "text-subtle"),
            "cursor-pointer appearance-auto pr-1",
            action && "pl-9 md:pl-8",
            error && "border-danger",
          )}
        >
          {options}
        </select>
      </div>
      <Status pending={pending} error={error} look={look} />
    </div>
  );
}

export function DateCell({
  rowId,
  value,
  overdue,
  look = "cell",
  className,
}: {
  rowId: string;
  value: string | null;
  overdue: boolean;
  look?: CellLook;
  className?: string;
}) {
  const { pending, error, save } = useCell(rowId, "followUpAt");
  const [draft, setDraft] = useSynced(value ?? "");
  return (
    <div className={className}>
      <input
        type="date"
        value={draft}
        aria-label="Follow-up date"
        title={overdue ? "Follow-up due" : "Follow up on (when the next step is due)"}
        onChange={(e) => {
          setDraft(e.currentTarget.value);
          save(e.currentTarget.value);
        }}
        className={cn(
          controlClass(look, false, overdue ? "font-medium text-danger" : draft ? "text-fg" : "text-subtle"),
          error && "border-danger",
        )}
      />
      <Status pending={pending} error={error} look={look} />
    </div>
  );
}

/** "Worked together before" checkbox. */
export function ReturningCell({ rowId, value, className }: { rowId: string; value: boolean; className?: string }) {
  const id = useId();
  const { pending, error, save } = useCell(rowId, "returning");
  const [draft, setDraft] = useSynced(value ? "true" : "false");
  return (
    <div className={className}>
      <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px] text-fg md:min-h-8 md:gap-2 md:text-sm">
        <Checkbox
          id={id}
          checked={draft === "true"}
          onChange={(e) => {
            const next = e.currentTarget.checked ? "true" : "false";
            setDraft(next);
            save(next);
          }}
        />
        Returning <span className="text-muted">· worked with us before</span>
      </label>
      <Status pending={pending} error={error} look="field" />
    </div>
  );
}

export function DeleteRowButton({ rowId, name, label }: { rowId: string; name: string; label?: string }) {
  const [pending, start] = useTransition();
  const remove = () => {
    if (window.confirm(`Remove ${name} from this sheet? The organization, contact and emails stay in the CRM.`)) {
      start(() => deleteRowAction(rowId));
    }
  };
  if (label) {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={remove}
        className="flex h-11 items-center gap-2 text-[15px] text-danger active:opacity-60 disabled:opacity-50 md:h-8 md:text-sm"
      >
        <Trash2 className="size-4" strokeWidth={1.75} />
        {pending ? "Removing…" : label}
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={`Remove ${name} from this sheet`}
      title="Remove from this sheet"
      onClick={remove}
      className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-subtle transition-colors hover:text-danger active:bg-surface-2 disabled:opacity-50 md:size-7 md:rounded-md md:hover:bg-surface-2"
    >
      <Trash2 className="size-4" strokeWidth={1.75} />
    </button>
  );
}
