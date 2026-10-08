"use client";

import { useId, useState, useTransition } from "react";
import { ChevronRight, Copy, FileText, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import type { TemplateVars } from "@/lib/booking/templates";
import type { EmailTemplate } from "@/lib/booking/types";
import { TEMPLATE_TRIGGERS, TEMPLATE_VARIABLES } from "@/lib/constants";
import type { TemplateTrigger } from "@/lib/types";
import { cn } from "@/lib/utils";
import { addStarterTemplatesAction, copyTemplatesAction, deleteTemplateAction } from "../../template-actions";
import { TemplateEditor, type EditorTarget, type PreviewRow } from "./template-editor";

export type { PreviewRow };

const TRIGGER_ORDER = new Map(TEMPLATE_TRIGGERS.map((t, i) => [t.value, i]));
const triggerLabel = (trigger: TemplateTrigger) => TEMPLATE_TRIGGERS.find((t) => t.value === trigger)?.label ?? trigger;

const TRIGGER_TONE: Record<TemplateTrigger, string> = {
  first_contact: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  returning: "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  follow_up: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  after_call: "bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300",
  next_steps: "bg-orange-50 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  confirmed: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  declined: "bg-surface-2 text-muted",
  keep_informed: "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  thanks: "bg-pink-50 text-pink-700 dark:bg-pink-950 dark:text-pink-300",
  custom: "bg-surface-2 text-subtle",
};

/** When a situation has no template, the one suggestTemplate falls back to. */
const FALLBACK: Partial<Record<TemplateTrigger, TemplateTrigger>> = { returning: "first_contact", after_call: "follow_up" };

/**
 * Shaped like <Badge>, colored here: Badge keeps its default bg / text classes (cn does not merge them),
 * and those beat blue, amber and emerald in the stylesheet.
 */
export function TriggerBadge({ trigger }: { trigger: TemplateTrigger }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center whitespace-nowrap rounded px-1.5 text-[11px] font-medium leading-none",
        TRIGGER_TONE[trigger],
      )}
    >
      {triggerLabel(trigger)}
    </span>
  );
}

/**
 * The sheet's email templates (and the ones shared by every sheet), in the
 * order of the situations they are suggested for; the situations without one;
 * starter templates and "copy from another sheet".
 */
export function TemplatesManager({
  projectId,
  sheetName,
  templates,
  previewRows,
  exampleVars,
  otherSheets,
  hasSignature,
}: {
  projectId: string;
  sheetName: string;
  templates: EmailTemplate[];
  previewRows: PreviewRow[];
  exampleVars: TemplateVars;
  otherSheets: { id: string; name: string }[];
  hasSignature: boolean;
}) {
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [, startTransition] = useTransition();

  const sorted = [...templates].sort(
    (a, b) =>
      (TRIGGER_ORDER.get(a.trigger) ?? 99) - (TRIGGER_ORDER.get(b.trigger) ?? 99) ||
      Number(a.projectId === null) - Number(b.projectId === null) ||
      a.sortOrder - b.sortOrder ||
      a.name.localeCompare(b.name),
  );
  const own = templates.filter((t) => t.projectId === projectId).length;
  const covered = new Set(templates.map((t) => t.trigger));
  const missing = TEMPLATE_TRIGGERS.filter((t) => t.value !== "custom" && !covered.has(t.value));

  function remove(template: EmailTemplate) {
    const where = template.projectId === null ? " It is shared by every booking sheet." : "";
    if (!window.confirm(`Delete the template “${template.name}”?${where}`)) return;
    setDeleting(template.id);
    startTransition(async () => {
      try {
        const result = await deleteTemplateAction(template.id);
        setMessage(result.ok ? null : { tone: "error", text: result.error });
      } catch {
        setMessage({ tone: "error", text: "Not deleted. Check your connection and try again." });
      } finally {
        setDeleting(null);
      }
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <section aria-labelledby="templates-title" className="flex flex-col">
        <div className="mb-1.5 flex min-h-7 items-end justify-between gap-3 px-4 md:mb-2 md:px-0">
          <h2 id="templates-title" className="text-[13px] uppercase tracking-wide text-subtle md:text-xs md:font-medium">
            Email templates <span className="ml-1 text-subtle/80">{templates.length}</span>
          </h2>
          {templates.length ? (
            <Button variant="primary" size="sm" onClick={() => setEditor({ mode: "new" })}>
              <Plus className="size-4" /> New template
            </Button>
          ) : null}
        </div>

        {templates.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-surface px-6 py-8 text-center md:rounded-lg">
            <p className="text-sm font-medium text-fg">No templates yet</p>
            <p className="max-w-md text-sm text-muted">
              “Prepare email” picks a template from where each venue stands: first contact, follow-up, after a call… Start from the seven Spanish starter
              templates and adjust them, or write your own.
            </p>
            <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row">
              <StarterButton projectId={projectId} onResult={setMessage} primary />
              <Button onClick={() => setEditor({ mode: "new" })}>
                <Plus className="size-4" /> New template
              </Button>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg">
            {sorted.map((t) => (
              <li key={t.id} className={cn("flex items-center", deleting === t.id && "opacity-50")}>
                <button
                  type="button"
                  onClick={() => setEditor({ mode: "edit", template: t })}
                  className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-left active:bg-surface-2 md:min-h-0 md:py-2 md:hover:bg-surface-2/60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-[15px] font-medium text-fg md:text-sm">{t.name}</span>
                      <TriggerBadge trigger={t.trigger} />
                      {t.projectId === null ? <Badge className="font-normal">Every sheet</Badge> : null}
                    </span>
                    <span className="mt-0.5 block truncate text-[13px] text-muted md:text-xs">{t.subject || "(no subject)"}</span>
                  </span>
                  <ChevronRight className="size-5 shrink-0 text-subtle md:hidden" aria-hidden />
                  <span className="hidden shrink-0 text-xs text-subtle md:inline">Edit</span>
                </button>
                <button
                  type="button"
                  onClick={() => remove(t)}
                  disabled={deleting === t.id}
                  aria-label={`Delete ${t.name}`}
                  title="Delete"
                  className="mr-2 hidden size-7 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-surface-2 hover:text-danger md:inline-flex"
                >
                  <Trash2 className="size-3.5" strokeWidth={1.75} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {templates.length && missing.length ? (
          <div className="mt-3 flex flex-col gap-1.5 px-4 md:px-0">
            <p className="text-xs text-muted">No template yet for:</p>
            <div className="flex flex-wrap gap-1.5">
              {missing.map((t) => {
                const fallback = FALLBACK[t.value];
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setEditor({ mode: "new", trigger: t.value })}
                    title={`Add a template for “${t.label}”`}
                    className="inline-flex h-9 items-center gap-1 rounded-full border border-dashed border-border px-3 text-[13px] text-muted active:bg-surface-2 md:h-7 md:px-2.5 md:text-xs md:hover:bg-surface-2 md:hover:text-fg"
                  >
                    <Plus className="size-3.5" aria-hidden />
                    {t.label}
                    {fallback && covered.has(fallback) ? <span className="text-subtle">· uses {triggerLabel(fallback)}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {message ? (
          <p role={message.tone === "error" ? "alert" : "status"} className={cn("mt-3 px-4 text-sm md:px-0", message.tone === "error" ? "text-danger" : "text-muted")}>
            {message.text}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="templates-more" className="flex flex-col">
        <h2 id="templates-more" className="mb-1.5 px-4 text-[13px] uppercase tracking-wide text-subtle md:mb-2 md:px-0 md:text-xs md:font-medium">
          Get templates
        </h2>
        <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface md:rounded-lg">
          {otherSheets.length ? <CopyFrom projectId={projectId} sheets={otherSheets} onResult={setMessage} /> : null}
          {templates.length ? (
            <div className="flex flex-col gap-2 p-4 md:flex-row md:items-center md:justify-between md:py-3">
              <p className="text-sm text-muted">
                {own ? "Add any starter template this sheet does not have yet (by name)." : "Add the seven Spanish starter templates to this sheet."}
              </p>
              <StarterButton projectId={projectId} onResult={setMessage} />
            </div>
          ) : null}
          <details className="group">
            <summary className="flex h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 text-[15px] text-fg md:h-10 md:text-sm [&::-webkit-details-marker]:hidden">
              Placeholders you can use
              <ChevronRight className="size-4 text-subtle transition-transform group-open:rotate-90" aria-hidden />
            </summary>
            <dl className="grid gap-x-4 gap-y-1.5 border-t border-border px-4 py-3 text-sm md:grid-cols-[auto_1fr]">
              {TEMPLATE_VARIABLES.map((v) => (
                <div key={v.name} className="contents">
                  <dt className="font-mono text-[13px] text-fg md:text-xs">{`{{${v.name}}}`}</dt>
                  <dd className="mb-1.5 text-muted md:mb-0">
                    {v.label} <span className="text-subtle">· {v.example}</span>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="border-t border-border px-4 py-3 text-xs text-subtle">
              {"{{first_name}}"} drops titles like Sr. or Dña. A value the venue does not have is left empty.
            </p>
          </details>
        </div>
      </section>

      {editor ? (
        <TemplateEditor
          key={editor.mode === "edit" ? editor.template.id : `new-${editor.trigger ?? ""}`}
          target={editor}
          projectId={projectId}
          sheetName={sheetName}
          previewRows={previewRows}
          exampleVars={exampleVars}
          hasSignature={hasSignature}
          onClose={() => setEditor(null)}
        />
      ) : null}
    </div>
  );
}

type OnResult = (message: { tone: "error" | "info"; text: string } | null) => void;

function StarterButton({ projectId, onResult, primary = false }: { projectId: string; onResult: OnResult; primary?: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant={primary ? "primary" : "secondary"}
      disabled={pending}
      className="w-full shrink-0 md:w-auto"
      onClick={() =>
        startTransition(async () => {
          try {
            const result = await addStarterTemplatesAction(projectId);
            if (!result.ok) onResult({ tone: "error", text: result.error });
            else
              onResult({
                tone: "info",
                text: result.added
                  ? `Added ${result.added} starter template${result.added === 1 ? "" : "s"}. Open each one to make it yours.`
                  : "This sheet already has every starter template.",
              });
          } catch {
            onResult({ tone: "error", text: "Not added. Check your connection and try again." });
          }
        })
      }
    >
      <FileText className="size-4" /> {pending ? "Adding…" : "Add starter templates"}
    </Button>
  );
}

function CopyFrom({ projectId, sheets, onResult }: { projectId: string; sheets: { id: string; name: string }[]; onResult: OnResult }) {
  const id = useId();
  const [from, setFrom] = useState(sheets[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="flex flex-col gap-2 p-4 md:py-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!from || pending) return;
        startTransition(async () => {
          try {
            const result = await copyTemplatesAction(from, projectId);
            if (!result.ok) onResult({ tone: "error", text: result.error });
            else
              onResult({
                tone: "info",
                text: result.copied
                  ? `Copied ${result.copied} template${result.copied === 1 ? "" : "s"}.`
                  : "Nothing to copy: that sheet has no templates of its own, or this sheet already has templates with the same names.",
              });
          } catch {
            onResult({ tone: "error", text: "Not copied. Check your connection and try again." });
          }
        });
      }}
    >
      <label htmlFor={id} className="text-sm text-muted">
        Copy templates from another sheet
      </label>
      <div className="flex flex-col gap-2 md:flex-row">
        <Select id={id} value={from} onChange={(e) => setFrom(e.target.value)} className="md:max-w-xs">
          {sheets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Button type="submit" disabled={pending || !from} className="w-full shrink-0 md:w-auto">
          <Copy className="size-4" /> {pending ? "Copying…" : "Copy"}
        </Button>
      </div>
    </form>
  );
}
