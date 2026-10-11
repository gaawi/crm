"use client";

import { useState } from "react";
import { Loader2, Mail, X } from "lucide-react";
import { GoalKindOptions, NextActionOptions } from "@/components/goals";
import type { EmailTemplate } from "@/lib/booking/types";
import { TEMPLATE_TRIGGERS } from "@/lib/constants";
import type { NextAction, OpportunityKind, OpportunityStage } from "@/lib/types";
import { cn } from "@/lib/utils";

const SUGGESTED = "";
const NEW_SECTION = "__new";
const NO_SECTION = "__none";
const NO_NEXT_ACTION = "__none";

const barSelect =
  "h-9 min-w-0 cursor-pointer appearance-auto rounded-lg border border-border bg-surface pl-2.5 pr-1.5 text-[15px] text-fg focus:border-border-strong focus:outline-none disabled:opacity-50 md:h-8 md:rounded-md md:text-sm";

function triggerLabel(template: EmailTemplate): string {
  return TEMPLATE_TRIGGERS.find((t) => t.value === template.trigger)?.label ?? template.trigger;
}

/**
 * Floating bar for the selected rows: prepare one email per row (each row's
 * suggested template, or one template for all; they go to Approvals, nothing
 * is sent), set their status, goal, next step or section, clear the
 * selection.
 */
export function BulkBar({
  count,
  visible,
  onSelectAll,
  onClear,
  templates,
  preparing,
  onPrepare,
  stageOptions,
  onSetStage,
  sections,
  onSetSection,
  onSetKind,
  onSetNextAction,
  busy,
  canPrepare,
}: {
  count: number;
  /** Rows on screen (for "Select all"). */
  visible: number;
  onSelectAll: () => void;
  onClear: () => void;
  templates: EmailTemplate[];
  preparing: boolean;
  /** null = each row's suggested template. */
  onPrepare: (templateId: string | null) => void;
  stageOptions: { value: OpportunityStage; label: string }[];
  onSetStage: (stage: OpportunityStage) => void;
  sections: string[];
  /** null = no section. */
  onSetSection: (section: string | null) => void;
  onSetKind: (kind: OpportunityKind) => void;
  /** null = clear the next step. */
  onSetNextAction: (action: NextAction | null) => void;
  busy: boolean;
  /** Why emails can't be prepared at all (no Gmail account), or null. */
  canPrepare: string | null;
}) {
  const [templateId, setTemplateId] = useState(SUGGESTED);
  const own = templates.filter((t) => t.projectId !== null);
  const global = templates.filter((t) => t.projectId === null);
  const chosen = templates.find((t) => t.id === templateId) ?? null;

  return (
    <div className="pointer-events-none fixed inset-x-2 bottom-[calc(env(safe-area-inset-bottom)+3.75rem)] z-40 flex justify-center md:inset-x-auto md:bottom-5 md:left-[calc(14rem+2rem)] md:right-8">
      <div
        role="toolbar"
        aria-label="Selected rows"
        className="pointer-events-auto flex w-full min-w-0 max-w-3xl flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface/95 p-2 shadow-xl backdrop-blur-xl md:w-auto md:max-w-none md:rounded-xl"
      >
        <div className="flex min-w-0 flex-1 items-center gap-1 md:flex-none">
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear selection"
            title="Clear selection"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted active:bg-surface-2 md:size-8 md:rounded-md md:hover:bg-surface-2"
          >
            <X className="size-4" strokeWidth={2} />
          </button>
          <span className="whitespace-nowrap text-[15px] font-medium tabular-nums md:text-sm">{count} selected</span>
          {count < visible ? (
            <button
              type="button"
              onClick={onSelectAll}
              className="ml-1 h-9 whitespace-nowrap px-1 text-[15px] text-blue-600 active:opacity-60 md:h-8 md:text-sm md:hover:underline dark:text-blue-400"
            >
              All {visible}
            </button>
          ) : null}
        </div>

        <div className="flex min-w-0 basis-full items-center gap-2 md:basis-auto">
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.currentTarget.value)}
            aria-label="Template"
            disabled={preparing}
            className={cn(barSelect, "flex-1 md:w-52 md:flex-none")}
          >
            <option value={SUGGESTED}>Suggested template per row</option>
            {own.length ? (
              <optgroup label="This campaign">
                {own.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} — {triggerLabel(t)}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {global.length ? (
              <optgroup label="All campaigns">
                {global.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} — {triggerLabel(t)}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
          <button
            type="button"
            disabled={preparing || busy || Boolean(canPrepare)}
            title={canPrepare ?? `${chosen ? `“${chosen.name}”` : "Each row's suggested template"} — the emails go to Approvals, nothing is sent`}
            onClick={() => {
              const what = chosen ? `“${chosen.name}”` : "each row's suggested template";
              if (
                count > 1 &&
                !window.confirm(
                  `Prepare ${count} emails with ${what}? They go to Approvals as one mailing; nothing is sent until you approve it there, and then they go out a few at a time.`,
                )
              )
                return;
              onPrepare(chosen?.id ?? null);
            }}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-accent px-3 text-[15px] font-medium text-accent-fg active:opacity-70 disabled:opacity-50 md:h-8 md:rounded-md md:text-sm md:hover:opacity-90"
          >
            {preparing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Mail className="size-4" strokeWidth={1.75} aria-hidden />}
            Prepare emails ({count})
          </button>
        </div>

        {/* Phones: a 2 × 2 grid; desktop: one row (it wraps under the email controls when the window is narrow). */}
        <div className="grid min-w-0 basis-full grid-cols-2 items-center gap-2 md:flex md:basis-auto">
          <select
            value=""
            disabled={busy}
            aria-label="Set status of the selected rows"
            onChange={(e) => {
              const stage = e.currentTarget.value as OpportunityStage;
              if (stage) onSetStage(stage);
            }}
            className={cn(barSelect, "w-full md:w-32")}
          >
            <option value="">Set status…</option>
            {stageOptions.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            value=""
            disabled={busy}
            aria-label="Set goal of the selected rows"
            onChange={(e) => {
              const kind = e.currentTarget.value as OpportunityKind;
              if (kind) onSetKind(kind);
            }}
            className={cn(barSelect, "w-full md:w-32")}
          >
            <option value="">Set goal…</option>
            <GoalKindOptions />
          </select>
          <select
            value=""
            disabled={busy}
            aria-label="Set next step of the selected rows"
            onChange={(e) => {
              const value = e.currentTarget.value;
              if (value === NO_NEXT_ACTION) onSetNextAction(null);
              else if (value) onSetNextAction(value as NextAction);
            }}
            className={cn(barSelect, "w-full md:w-36")}
          >
            <option value="">Set next step…</option>
            <NextActionOptions />
            <option value={NO_NEXT_ACTION}>No next step</option>
          </select>
          <select
            value=""
            disabled={busy}
            aria-label="Set section of the selected rows"
            onChange={(e) => {
              const value = e.currentTarget.value;
              if (value === NEW_SECTION) {
                const name = window.prompt("New section name")?.replace(/\s+/g, " ").trim();
                if (name) onSetSection(name.slice(0, 120));
              } else if (value === NO_SECTION) {
                onSetSection(null);
              } else if (value) {
                onSetSection(value);
              }
            }}
            className={cn(barSelect, "w-full md:w-32")}
          >
            <option value="">Set section…</option>
            {sections.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            <option value={NEW_SECTION}>New section…</option>
            {sections.length ? <option value={NO_SECTION}>No section</option> : null}
          </select>
          {busy ? <Loader2 className="hidden size-4 shrink-0 animate-spin text-muted md:block" aria-label="Saving" /> : null}
        </div>
      </div>
    </div>
  );
}
