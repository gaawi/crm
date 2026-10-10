"use client";

import Link from "next/link";
import { useCallback, useId, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { renderTemplate, unknownPlaceholders, type TemplateVariable, type TemplateVars } from "@/lib/booking/templates";
import type { EmailTemplate } from "@/lib/booking/types";
import { TEMPLATE_TRIGGERS, TEMPLATE_VARIABLES } from "@/lib/constants";
import type { TemplateTrigger } from "@/lib/types";
import { cn } from "@/lib/utils";
import { createTemplateAction, deleteTemplateAction, updateTemplateAction } from "../../template-actions";

/** A row of the sheet the preview can render with. */
export interface PreviewRow {
  id: string;
  /** "Teatro Campoamor · Ana López" */
  label: string;
  vars: TemplateVars;
}

export type EditorTarget = { mode: "new"; trigger?: TemplateTrigger } | { mode: "edit"; template: EmailTemplate };

const KNOWN_NAMES = new Set(TEMPLATE_VARIABLES.map((v) => v.name));

/** Known placeholders a text uses, in order of appearance. */
function usedVariables(text: string): TemplateVariable[] {
  const out: TemplateVariable[] = [];
  for (const m of text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)) {
    const name = m[1].toLowerCase();
    if (KNOWN_NAMES.has(name) && !out.includes(name as TemplateVariable)) out.push(name as TemplateVariable);
  }
  return out;
}

/**
 * Create or edit an email template: name, situation (trigger), subject and
 * body with placeholder chips, and a live preview rendered with a row of the
 * sheet. A right-hand panel on desktop, a full-screen sheet on phones.
 */
export function TemplateEditor({
  target,
  projectId,
  sheetName,
  previewRows,
  exampleVars,
  hasSignature,
  onClose,
}: {
  target: EditorTarget;
  projectId: string;
  sheetName: string;
  previewRows: PreviewRow[];
  exampleVars: TemplateVars;
  hasSignature: boolean;
  onClose: () => void;
}) {
  const formId = useId();
  const editing = target.mode === "edit" ? target.template : null;
  const initial = {
    name: editing?.name ?? "",
    trigger: editing?.trigger ?? (target.mode === "new" ? target.trigger : undefined) ?? "first_contact",
    subject: editing?.subject ?? "",
    body: editing?.body ?? "",
  };
  const [values, setValues] = useState(initial);
  const [scope, setScope] = useState<"sheet" | "global">("sheet");
  const [previewId, setPreviewId] = useState(previewRows[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  // Where a placeholder chip inserts: the field focused last (the body by default).
  const lastField = useRef<"subject" | "body">("body");

  const dirty =
    values.name !== initial.name || values.trigger !== initial.trigger || values.subject !== initial.subject || values.body !== initial.body;
  const trigger = TEMPLATE_TRIGGERS.find((t) => t.value === values.trigger);
  const previewRow = previewRows.find((r) => r.id === previewId) ?? null;
  const vars = previewRow?.vars ?? exampleVars;
  const renderedSubject = renderTemplate(values.subject, vars);
  const renderedBody = renderTemplate(values.body, vars);
  const unknown = unknownPlaceholders(`${values.subject}\n${values.body}`);
  const used = usedVariables(`${values.subject}\n${values.body}`);
  const empty = used.filter((name) => renderTemplate(`{{${name}}}`, vars).trim() === "");

  const set = <K extends keyof typeof values>(name: K, value: (typeof values)[K]) => {
    setValues((v) => ({ ...v, [name]: value }));
    setError(null);
  };

  const requestClose = useCallback(() => {
    if (pending) return;
    if (dirty && !window.confirm("Discard your changes to this template?")) return;
    onClose();
  }, [pending, dirty, onClose]);

  function insert(name: string) {
    const token = `{{${name}}}`;
    const field = lastField.current;
    const el = field === "subject" ? subjectRef.current : bodyRef.current;
    const current = values[field];
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    set(field, current.slice(0, start) + token + current.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (pending) return;
    if (!values.name.trim()) return setError("Give the template a name.");
    if (!values.body.trim()) return setError("Write the email text.");
    setError(null);
    const input = { name: values.name, trigger: values.trigger, subject: values.subject, body: values.body };
    startTransition(async () => {
      try {
        const result = editing
          ? await updateTemplateAction(editing.id, input)
          : await createTemplateAction(scope === "global" ? null : projectId, input);
        if (!result.ok) return setError(result.error);
        onClose();
      } catch {
        setError("Not saved. Check your connection and try again.");
      }
    });
  }

  function remove() {
    if (!editing || pending) return;
    const where = editing.projectId === null ? " It is shared by every campaign." : "";
    if (!window.confirm(`Delete the template “${editing.name}”?${where}`)) return;
    startTransition(async () => {
      try {
        const result = await deleteTemplateAction(editing.id);
        if (!result.ok) return setError(result.error);
        onClose();
      } catch {
        setError("Not deleted. Check your connection and try again.");
      }
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <Sheet
      open
      onClose={requestClose}
      variant="panel"
      title={editing ? "Edit template" : "New template"}
      description={editing?.projectId === null ? "Shared by every campaign: changes apply to all of them." : undefined}
      primary={{ label: "Save", form: formId, pending }}
      className="md:w-[min(64rem,100vw)]"
      footer={
        <>
          {editing ? (
            <Button variant="danger" onClick={remove} disabled={pending} className="mr-auto">
              Delete
            </Button>
          ) : null}
          <Button variant="ghost" onClick={requestClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={pending}>
            {pending ? "Saving…" : editing ? "Save" : "Create template"}
          </Button>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2 lg:gap-6">
        <form id={formId} onSubmit={submit} onKeyDown={onKeyDown} aria-busy={pending} className="flex min-w-0 flex-col gap-4 md:gap-3">
          <Field label="Name" htmlFor={`${formId}-name`}>
            <Input
              id={`${formId}-name`}
              value={values.name}
              maxLength={120}
              placeholder="Propuesta"
              data-autofocus={editing ? undefined : true}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>

          <Field label="Suggested when" htmlFor={`${formId}-trigger`} hint={trigger?.hint}>
            <Select id={`${formId}-trigger`} value={values.trigger} onChange={(e) => set("trigger", e.target.value as TemplateTrigger)}>
              {TEMPLATE_TRIGGERS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>

          {editing ? null : (
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 text-xs font-medium text-muted">Available in</legend>
              <div className="grid grid-cols-2 gap-1 rounded-[10px] bg-surface-2 p-0.5 md:inline-grid md:w-fit md:rounded-lg">
                {(
                  [
                    { value: "sheet", label: "This campaign" },
                    { value: "global", label: "Every campaign" },
                  ] as const
                ).map((o) => (
                  <label
                    key={o.value}
                    className={cn(
                      "flex h-9 cursor-pointer items-center justify-center rounded-lg px-3 text-[15px] md:h-7 md:rounded-md md:text-xs",
                      scope === o.value ? "bg-surface font-medium text-fg shadow-sm" : "text-muted",
                    )}
                  >
                    <input
                      type="radio"
                      name="scope"
                      value={o.value}
                      checked={scope === o.value}
                      onChange={() => setScope(o.value)}
                      className="sr-only"
                    />
                    {o.label}
                  </label>
                ))}
              </div>
              <p className="text-xs text-subtle">
                {scope === "sheet" ? `Only in “${sheetName}”.` : "Offered in every campaign; a campaign's own template wins when both fit."}
              </p>
            </fieldset>
          )}

          <Field
            label="Subject"
            htmlFor={`${formId}-subject`}
            hint={values.trigger === "follow_up" ? "Follow-ups reply in your last email thread with them, so Gmail shows “Re: …” of that email." : undefined}
          >
            <Input
              ref={subjectRef}
              id={`${formId}-subject`}
              value={values.subject}
              maxLength={300}
              placeholder="Propuesta de colaboración — {{venue}}"
              onFocus={() => (lastField.current = "subject")}
              onChange={(e) => set("subject", e.target.value)}
            />
          </Field>

          <Field label="Email" htmlFor={`${formId}-body`}>
            <Textarea
              ref={bodyRef}
              id={`${formId}-body`}
              rows={14}
              value={values.body}
              maxLength={20_000}
              placeholder={"Buenos días {{first_name}}:\n\n…\n\n{{signature}}"}
              onFocus={() => (lastField.current = "body")}
              onChange={(e) => set("body", e.target.value)}
              className="min-h-64 md:min-h-56"
            />
          </Field>

          <div role="group" aria-labelledby={`${formId}-vars`} className="flex flex-col gap-1.5">
            <span id={`${formId}-vars`} className="text-xs font-medium text-muted">
              Insert a placeholder <span className="font-normal text-subtle">(at the cursor)</span>
            </span>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATE_VARIABLES.map((v) => (
                <button
                  key={v.name}
                  type="button"
                  title={`${v.label} · e.g. ${v.example}`}
                  // Keep the cursor where it was in the subject or body.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insert(v.name)}
                  className="inline-flex h-9 items-center rounded-full border border-border bg-surface px-3 font-mono text-[13px] text-fg active:bg-surface-2 md:h-6 md:px-2 md:text-[11px] md:hover:bg-surface-2"
                >
                  {`{{${v.name}}}`}
                </button>
              ))}
            </div>
          </div>

          {unknown.length ? (
            <p className="text-sm text-warning">
              Not a placeholder: {unknown.map((u) => `{{${u}}}`).join(", ")}. It will be left as written. Check the spelling.
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}

          {editing ? (
            <Button variant="danger" onClick={remove} disabled={pending} className="mt-2 w-full md:hidden">
              Delete template
            </Button>
          ) : null}
        </form>

        <section aria-label="Preview" className="flex min-w-0 flex-col gap-2 lg:sticky lg:top-0 lg:self-start">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${formId}-preview`} className="text-xs font-medium text-muted">
              Preview with
            </label>
            {previewRows.length ? (
              <Select id={`${formId}-preview`} value={previewId} onChange={(e) => setPreviewId(e.target.value)}>
                {previewRows.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
            ) : (
              <p id={`${formId}-preview`} className="text-sm text-subtle">
                Sample values (this campaign has no contacts yet).
              </p>
            )}
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg">
            <p className="border-b border-border px-4 py-2.5 text-[15px] font-medium text-fg md:px-3 md:py-2 md:text-sm">
              {renderedSubject.trim() || <span className="font-normal text-subtle">(no subject)</span>}
            </p>
            <div className="max-h-[28rem] overflow-y-auto whitespace-pre-wrap break-words px-4 py-3 text-[15px] leading-relaxed text-fg md:px-3 md:text-sm">
              {renderedBody.trim() || <span className="text-subtle">The email text appears here as the recipient will read it.</span>}
            </div>
          </div>
          {empty.length ? (
            <p className="text-xs text-muted">
              Empty for this contact: {empty.map((name) => `{{${name}}}`).join(", ")}.
              {empty.includes("signature") && !hasSignature ? (
                <>
                  {" "}
                  Add your signature in{" "}
                  <Link href="/settings" className="underline underline-offset-2 hover:text-fg">
                    Settings
                  </Link>
                  .
                </>
              ) : null}
            </p>
          ) : null}
          <p className="text-xs text-subtle">Prepared emails open in Approvals first: you can still edit them there before anything is sent.</p>
        </section>
      </div>
    </Sheet>
  );
}
