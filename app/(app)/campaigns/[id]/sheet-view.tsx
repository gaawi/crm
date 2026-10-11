"use client";

import { useCallback, useDeferredValue, useEffect, useId, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { useActivityLogger } from "@/components/booking/log-activity-dialog";
import { EmptyState } from "@/components/ui/layout";
import {
  EMPTY_FILTERS,
  filterRows,
  groupBySection,
  NO_SECTION,
  sheetFiltersFromParams,
  sheetFiltersToQuery,
  sheetSections,
  type SheetFilters,
} from "@/lib/booking/filters";
import { suggestTemplate } from "@/lib/booking/templates";
import { isFollowUpDue, isNoReply } from "@/lib/booking/timing";
import type { BookingSheet, EmailTemplate, SheetRow } from "@/lib/booking/types";
import { GOAL_KINDS, goalLabel, labelKindFor, nextActionLabel, stageLabel } from "@/lib/constants";
import type { NextAction, OpportunityKind, OpportunityStage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { bulkUpdateRowsAction, prepareEmailsAction } from "../actions";
import { AddRowButton } from "./add-row";
import { BulkBar } from "./bulk-bar";
import { FiltersBar } from "./filters-bar";
import { HistoryDrawer } from "./history-drawer";
import { ImportButton } from "./import-dialog";
import { RowCard } from "./row-card";
import { rowSubject, STAGE_DOT, stageOptions, type EmailSuggestion, type RowActions, type RowContext } from "./row-meta";
import { RowsTable } from "./rows-table";
import { useSheetToast } from "./sheet-toast";
import { ConfirmedStrip, StatsStrip, type StatItem } from "./stats";

/**
 * The booking sheet screen (below the page header): counts that filter,
 * confirmed venues, search and filters (kept in the URL), rows grouped by
 * section — a table on desktop, cards on phones — the bulk bar, and the
 * History drawer. Filtering is client-side; every edit goes through a
 * server action whose refresh() brings back fresh rows.
 */

const COMPACT_KEY = "crm:booking:compact";
const COMPACT_EVENT = "crm:booking-compact";

function subscribeCompact(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(COMPACT_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(COMPACT_EVENT, onChange);
  };
}

function readCompact(): boolean {
  try {
    return window.localStorage.getItem(COMPACT_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCompact(on: boolean) {
  try {
    if (on) window.localStorage.setItem(COMPACT_KEY, "1");
    else window.localStorage.removeItem(COMPACT_KEY);
  } catch {
    // Private mode / blocked storage: the toggle still works for this visit.
  }
  window.dispatchEvent(new Event(COMPACT_EVENT));
}

/** Compact phone cards, remembered on this device. */
function useCompact(): [boolean, (on: boolean) => void] {
  const stored = useSyncExternalStore(subscribeCompact, readCompact, () => false);
  const [override, setOverride] = useState<boolean | null>(null);
  const set = useCallback((on: boolean) => {
    setOverride(on);
    writeCompact(on);
  }, []);
  return [override ?? stored, set];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function SheetView({
  sheet,
  rows,
  templates,
  sendAccountEmail,
  today,
  timezone,
}: {
  sheet: BookingSheet;
  rows: SheetRow[];
  templates: EmailTemplate[];
  /** The mailbox Prepare email uses (null = no connected Gmail account). */
  sendAccountEmail: string | null;
  /** 'YYYY-MM-DD' in the owner's timezone (server's today, so server and client agree). */
  today: string;
  timezone: string;
}) {
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<SheetFilters>(() => sheetFiltersFromParams(new URLSearchParams(searchParams.toString())));
  const deferredFilters = useDeferredValue(filters);
  const [compact, setCompact] = useCompact();
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [drawerRowId, setDrawerRowId] = useState<string | null>(null);
  const [preparing, setPreparing] = useState<ReadonlySet<string>>(() => new Set());
  const [bulkPending, startBulk] = useTransition();
  const sectionsListId = useId();

  // Filters live in the URL (links and Back keep them); replaceState keeps typing out of the history.
  useEffect(() => {
    const query = sheetFiltersToQuery(filters);
    if (query !== window.location.search) window.history.replaceState(null, "", `${window.location.pathname}${query}`);
  }, [filters]);

  const sections = useMemo(() => sheetSections(rows), [rows]);
  const hasUnsectioned = useMemo(() => sections.length > 0 && rows.some((r) => !r.section), [rows, sections]);
  const visible = useMemo(() => filterRows(rows, deferredFilters, today, timezone), [rows, deferredFilters, today, timezone]);
  const groups = useMemo(() => groupBySection(visible), [visible]);
  const confirmed = useMemo(() => rows.filter((r) => r.stage === "won"), [rows]);
  // Sheet-level status names: the booking ones while every row is a booking (or every row shares one goal), generic ones for a mix.
  const labelKind = useMemo(() => labelKindFor(rows.map((r) => r.kind)), [rows]);
  const sheetStages = useMemo(() => stageOptions(labelKind), [labelKind]);

  const noAccount = sendAccountEmail ? null : "Connect a Gmail account in Settings first";
  const suggestions = useMemo(() => {
    const map = new Map<string, EmailSuggestion>();
    for (const row of rows) {
      const template = suggestTemplate(row, templates);
      const reason = !row.contact?.email
        ? "No email address"
        : !template
          ? `No template for “${stageLabel(row.stage, row.kind)}” rows. Add one in Templates & settings.`
          : noAccount;
      map.set(row.id, { template, reason, draftId: row.contact?.openDraftId ?? null });
    }
    return map;
  }, [rows, templates, noAccount]);

  // Selection only ever covers rows on screen.
  const selectedVisible = useMemo(() => visible.filter((r) => selected.has(r.id)).map((r) => r.id), [visible, selected]);
  const drawerRow = drawerRowId ? (rows.find((r) => r.id === drawerRowId) ?? null) : null;

  const toast = useSheetToast({ raised: selectedVisible.length > 0 });
  const showToast = toast.show;
  const logger = useActivityLogger({ timezone });
  const openLog = logger.open;

  const prepare = useCallback(
    async (rowIds: string[], templateId: string | null) => {
      setPreparing((prev) => new Set([...prev, ...rowIds]));
      try {
        const result = await prepareEmailsAction(sheet.id, rowIds, templateId);
        if (!result.ok) {
          showToast({ tone: "error", message: result.error });
          return;
        }
        const { prepared, skipped, campaignId } = result;
        const reasons = [...new Set(skipped.map((s) => s.reason))];
        if (rowIds.length === 1) {
          if (prepared[0]) {
            showToast({
              message: `“${prepared[0].templateName}” is ready in Approvals.`,
              detail: "Review and send it from there. Nothing was sent.",
              link: { label: "Review", href: `/approvals/${prepared[0].draftId}` },
            });
          } else {
            showToast({ tone: "error", message: skipped[0]?.reason ?? "Not prepared." });
          }
          return;
        }
        const skippedText = skipped.length
          ? `${plural(skipped.length, "row")} skipped: ${reasons.slice(0, 3).join("; ")}${reasons.length > 3 ? "…" : ""}`
          : null;
        showToast({
          tone: prepared.length ? "default" : "error",
          message: !prepared.length
            ? "No emails prepared."
            : campaignId
              ? `${plural(prepared.length, "email")} ready as a mailing — review in Approvals.`
              : `${plural(prepared.length, "email")} ready in Approvals.`,
          detail: [skippedText, campaignId ? "Nothing was sent. Once you approve the campaign, they go out a few at a time." : "Nothing was sent."]
            .filter(Boolean)
            .join(" "),
          link: campaignId
            ? { label: "Review", href: `/approvals/mailings/${campaignId}` }
            : prepared.length
              ? { label: "Open Approvals", href: "/approvals" }
              : undefined,
        });
      } catch {
        showToast({ tone: "error", message: "Could not prepare the emails. Check your connection and try again." });
      } finally {
        setPreparing((prev) => {
          const next = new Set(prev);
          for (const id of rowIds) next.delete(id);
          return next;
        });
      }
    },
    [sheet.id, showToast],
  );

  const actions = useMemo<RowActions>(
    () => ({
      onToggle: (rowId) =>
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(rowId)) next.delete(rowId);
          else next.add(rowId);
          return next;
        }),
      onHistory: (rowId) => setDrawerRowId(rowId),
      onLog: (row, kind) => openLog({ target: { opportunityId: row.id }, kind, subject: rowSubject(row), phone: row.contact?.phone ?? null }),
      onPrepare: (row) => {
        const suggestion = suggestions.get(row.id);
        if (suggestion?.reason) {
          showToast({ message: suggestion.reason });
          return;
        }
        void prepare([row.id], null);
      },
    }),
    [openLog, prepare, suggestions, showToast],
  );

  const selectMany = useCallback((rowIds: string[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of rowIds) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setSelectMode(false);
  }, []);

  const bulkUpdate = (patch: { stage?: OpportunityStage; section?: string | null; kind?: OpportunityKind; nextAction?: NextAction | null }) => {
    const ids = selectedVisible;
    startBulk(async () => {
      try {
        const result = await bulkUpdateRowsAction(sheet.id, ids, patch);
        if (!result.ok) {
          showToast({ tone: "error", message: result.error });
          return;
        }
        const what =
          patch.stage !== undefined
            ? `set to ${stageLabel(patch.stage, labelKind)}`
            : patch.kind !== undefined
              ? `set to the goal “${goalLabel(patch.kind)}”`
              : patch.nextAction !== undefined
                ? patch.nextAction
                  ? `set to the next step “${nextActionLabel(patch.nextAction)}”`
                  : "cleared of their next step"
                : patch.section
                  ? `moved to ${patch.section}`
                  : "moved out of their section";
        showToast({ message: `${plural(result.updated, "row")} ${what}.` });
      } catch {
        showToast({ tone: "error", message: "Not saved. Check your connection and try again." });
      }
    });
  };

  const ctx = useMemo<RowContext>(() => ({ currency: sheet.currency, today, timezone, sectionsListId }), [sheet.currency, today, timezone, sectionsListId]);

  // Counts over the whole sheet; each one filters.
  const stats = useMemo<StatItem[]>(() => {
    const count = (stage: OpportunityStage) => rows.filter((r) => r.stage === stage).length;
    const due = rows.filter((r) => isFollowUpDue(r, today)).length;
    const noReply = rows.filter((r) => isNoReply(r, today, timezone)).length;
    const setStatus = (stage: OpportunityStage) => () => setFilters((f) => ({ ...f, status: f.status === stage ? "" : stage }));
    const toggleFlag = (flag: "due" | "no_reply") => () =>
      setFilters((f) => ({ ...f, flags: f.flags.includes(flag) ? f.flags.filter((x) => x !== flag) : [...f.flags, flag] }));
    const stage = (value: OpportunityStage, always = true): StatItem[] => {
      const n = count(value);
      if (!always && n === 0 && filters.status !== value) return [];
      return [{ key: value, label: stageLabel(value, labelKind), count: n, dot: STAGE_DOT[value], active: filters.status === value, onClick: setStatus(value) }];
    };
    return [
      {
        key: "total",
        label: "Total",
        count: rows.length,
        active: !filters.status && !filters.flags.includes("due") && !filters.flags.includes("no_reply"),
        onClick: () => setFilters((f) => ({ ...f, status: "", flags: f.flags.filter((x) => x !== "due" && x !== "no_reply") })),
      },
      ...stage("lead"),
      ...stage("contacted"),
      // Not in the old tracker; shown once a row is in it, so the counts add up.
      ...stage("proposal", false),
      ...stage("negotiation"),
      ...stage("won"),
      ...stage("lost"),
      { key: "due", label: "Follow-ups due", count: due, tone: "danger", active: filters.flags.includes("due"), onClick: toggleFlag("due") },
      { key: "no_reply", label: "No reply", count: noReply, tone: "warning", active: filters.flags.includes("no_reply"), onClick: toggleFlag("no_reply") },
    ];
  }, [rows, today, timezone, filters.status, filters.flags, labelKind]);

  const statusOptions = useMemo(
    () => sheetStages.map((s) => ({ ...s, count: rows.filter((r) => r.stage === s.value).length })),
    [rows, sheetStages],
  );
  // The sheet's goals in GOAL_KINDS order (a filter once there are two).
  const goalOptions = useMemo(
    () =>
      GOAL_KINDS.map((k) => ({ value: k.value, label: k.label, count: rows.filter((r) => r.kind === k.value).length })).filter(
        (k) => k.count > 0 || k.value === filters.kind,
      ),
    [rows, filters.kind],
  );

  const showSectionHeaders = sections.length > 0;
  const bulkVisible = selectedVisible.length > 0;
  const stale = deferredFilters !== filters;

  if (!rows.length) {
    return (
      <EmptyState
        title="No contacts yet"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <AddRowButton projectId={sheet.id} currency={sheet.currency} phonePrefix={sheet.phonePrefix} sections={[]} variant="button" />
            <ImportButton projectId={sheet.id} sections={[]} />
          </div>
        }
      >
        Add them one by one, or import a list: a CSV or TSV file, or rows pasted from a spreadsheet.
      </EmptyState>
    );
  }

  return (
    <div className={cn(bulkVisible && "pb-48 md:pb-28")}>
      {/* Phones: only the counts stick (the wrapper is display: contents). Desktop: counts and filters stick together. */}
      <div className="contents md:sticky md:top-0 md:z-20 md:-mx-8 md:mb-4 md:block md:border-b md:border-border md:bg-bg/90 md:px-8 md:py-2.5 md:backdrop-blur-xl">
        <div className="sticky top-0 z-20 -mx-4 mb-3 border-b border-border bg-bg/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-xl md:static md:mx-0 md:mb-0 md:border-0 md:bg-transparent md:px-0 md:pt-0 md:backdrop-blur-none">
          <StatsStrip items={stats} />
        </div>
        <FiltersBar
          filters={filters}
          onChange={setFilters}
          statusOptions={statusOptions}
          goalOptions={goalOptions}
          sections={sections}
          hasUnsectioned={hasUnsectioned}
          shown={visible.length}
          total={rows.length}
          compact={compact}
          onCompact={setCompact}
          selectMode={selectMode}
          onSelectMode={(on) => {
            setSelectMode(on);
            if (!on) setSelected(new Set());
          }}
        />
      </div>

      <ConfirmedStrip rows={confirmed} label={stageLabel("won", labelKind)} />

      <datalist id={sectionsListId}>
        {sections.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      {visible.length ? (
        <div className={cn("transition-opacity", stale && "opacity-70")}>
          <RowsTable
            groups={groups}
            showSectionHeaders={showSectionHeaders}
            ctx={ctx}
            actions={actions}
            selected={selected}
            onSelectMany={selectMany}
            suggestions={suggestions}
            preparing={preparing}
          />

          {/* Phones: cards grouped by section. */}
          <div className="flex flex-col gap-6 md:hidden">
            {groups.map((group) => (
              <section key={group.section ?? "\u0000other"} aria-label={showSectionHeaders ? (group.section ?? "Other") : undefined}>
                {showSectionHeaders ? (
                  <h2 className="mb-2 flex items-baseline gap-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-muted">
                    <span className="min-w-0 truncate">{group.section ?? "Other"}</span>
                    <span className="font-medium tabular-nums text-subtle">{group.rows.length}</span>
                    {selectMode ? (
                      <button
                        type="button"
                        onClick={() => selectMany(group.rows.map((r) => r.id), !group.rows.every((r) => selected.has(r.id)))}
                        className="ml-auto h-8 shrink-0 text-[13px] font-normal normal-case tracking-normal text-blue-600 active:opacity-60 dark:text-blue-400"
                      >
                        {group.rows.every((r) => selected.has(r.id)) ? "Unselect" : "Select all"}
                      </button>
                    ) : null}
                  </h2>
                ) : null}
                <ul
                  className={cn(
                    compact ? "divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface" : "flex flex-col gap-3",
                  )}
                >
                  {group.rows.map((row) => (
                    <RowCard
                      key={row.id}
                      row={row}
                      ctx={ctx}
                      actions={actions}
                      suggestion={suggestions.get(row.id)!}
                      preparing={preparing.has(row.id)}
                      compact={compact}
                      selectMode={selectMode}
                      selected={selected.has(row.id)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      ) : (
        <EmptyState
          title="No contacts match"
          action={
            <button type="button" onClick={() => setFilters(EMPTY_FILTERS)} className="text-sm font-medium text-fg underline-offset-2 hover:underline">
              Clear filters
            </button>
          }
        >
          {filters.section === NO_SECTION ? "Every contact has a section." : "Try another search or fewer filters."}
        </EmptyState>
      )}

      {bulkVisible ? (
        <BulkBar
          count={selectedVisible.length}
          visible={visible.length}
          onSelectAll={() => selectMany(visible.map((r) => r.id), true)}
          onClear={clearSelection}
          templates={templates}
          preparing={selectedVisible.some((id) => preparing.has(id))}
          onPrepare={(templateId) => void prepare(selectedVisible.slice(0, 100), templateId)}
          stageOptions={sheetStages}
          onSetStage={(stage) => bulkUpdate({ stage })}
          sections={sections}
          onSetSection={(section) => bulkUpdate({ section })}
          onSetKind={(kind) => bulkUpdate({ kind })}
          onSetNextAction={(nextAction) => bulkUpdate({ nextAction })}
          busy={bulkPending}
          canPrepare={noAccount ?? (selectedVisible.length > 100 ? "Select at most 100 rows to prepare emails" : null)}
        />
      ) : null}

      <HistoryDrawer
        row={drawerRow}
        onClose={() => setDrawerRowId(null)}
        ctx={ctx}
        suggestion={drawerRow ? (suggestions.get(drawerRow.id) ?? null) : null}
        preparing={drawerRow ? preparing.has(drawerRow.id) : false}
        onPrepare={actions.onPrepare}
      />
      {logger.dialog}
      {toast.node}
    </div>
  );
}
