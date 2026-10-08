"use client";

import { useDeferredValue, useId, useMemo, useState, useTransition, type ChangeEvent } from "react";
import { Download, FileUp, Upload } from "lucide-react";
import { Badge, StageBadge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, parseSheetImport, type ImportField, type ParsedImportRow } from "@/lib/booking/csv-import";
import type { ImportResult } from "@/lib/booking/types";
import { stageLabel } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { importRowsAction } from "../actions";

const FIELD_LABELS: Record<ImportField, string> = {
  organization: "Venue",
  city: "City",
  website: "Website",
  spaces: "Spaces",
  section: "Section",
  contactName: "Contact",
  role: "Role",
  email: "Email",
  phone: "Phone",
  whatsapp: "WhatsApp",
  eventDates: "Dates",
  fee: "Fee",
  followUpAt: "Follow up",
  nextAction: "Next action",
  nextStep: "Next step",
  notes: "Notes",
  stage: "Status",
  kind: "Goal",
  returning: "Returning",
};

const DELIMITERS = { ";": "semicolons", ",": "commas", "\t": "tabs" } as const;

/** Lines the parser adds to a row's notes when a cell could not be read. */
const UNREAD = /^(Email \(not valid\)|Phone|WhatsApp|Status|Fee|Follow up|Next action|Goal): /m;

const PREVIEW_ROWS = 5;

const EXAMPLE = [
  "Sala;Localidad;Espacios;Contacto;Cargo;Email;Teléfono;Sección;Estado;Previo;Notas",
  "Teatro de la Laboral;Gijón;Sala principal, Paraninfo;Ana López;Directora artística;ana@ejemplo.es;985 000 000;Otros espacios de Asturias;Pendiente;sí;",
  "Casa de Cultura;Lalín;Auditorio;Xosé Pereira;Técnico de cultura;cultura@ejemplo.gal;600 000 000;Cultura en Rede;Email enviado;;Llamar por la mañana",
].join("\r\n");

/** Excel saves "CSV" in the Windows code page; anything that is not valid UTF-8 is read as Windows-1252. */
async function readFileText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

function downloadExample() {
  const url = URL.createObjectURL(new Blob([`﻿${EXAMPLE}\r\n`], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "booking-import-example.csv";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Non-empty cells of the header (first non-empty line). */
function headerCellCount(text: string, delimiter: string): number {
  const line = text.replace(/^\uFEFF/, "").split(/\r\n?|\n/).find((l) => l.trim() !== "") ?? "";
  let count = 0;
  let cell = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === delimiter && !quoted) {
      if (cell.trim()) count++;
      cell = "";
    } else cell += ch;
  }
  return cell.trim() ? count + 1 : count;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * "Import" on a booking sheet: paste rows copied from Excel / Google Sheets or
 * pick a .csv / .tsv file, check the preview (recognized columns, first rows,
 * problems) and add them all. One bad row never stops the others.
 */
export function ImportButton({ projectId, sections }: { projectId: string; sections: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Upload className="size-4" /> Import
      </Button>
      {open ? <ImportSheet projectId={projectId} sections={sections} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ImportSheet({ projectId, sections, onClose }: { projectId: string; sections: string[]; onClose: () => void }) {
  const id = useId();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, startTransition] = useTransition();

  // Parsing a large paste can take a moment: the preview may lag one keystroke behind.
  const deferred = useDeferredValue(text);
  const parsed = useMemo(() => (deferred.trim() ? parseSheetImport(deferred) : null), [deferred]);
  const stale = deferred !== text;
  const rows = parsed?.rows ?? [];
  const errors = parsed?.errors ?? [];
  // Input-level problems (too large, empty, no venue column): nothing can be imported.
  const inputProblem =
    errors.find((e) => e.line === 0) ?? (parsed && !parsed.columns.includes("organization") ? (errors[0] ?? null) : null);
  const known = new Set(sections.map((s) => s.toLowerCase()));
  const importSections = [...new Map(rows.flatMap((r) => (r.section ? [[r.section.toLowerCase(), r.section] as const] : []))).values()];
  const newSections = importSections.filter((s) => !known.has(s.toLowerCase()));
  const repeated = parsed && !inputProblem ? headerCellCount(deferred, parsed.delimiter) - parsed.columns.length - parsed.ignored.length : 0;
  const unread = rows.filter((r) => r.notes && UNREAD.test(r.notes)).length;
  const canImport = rows.length > 0 && !pending && !stale && !result;

  async function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setResult(null);
    if (file.size > IMPORT_MAX_BYTES) {
      setInputError(`${file.name} is larger than 1 MB. Split it into smaller files.`);
      return;
    }
    try {
      setText(await readFileText(file));
      setFileName(file.name);
      setInputError(null);
    } catch {
      setInputError(`Could not read ${file.name}.`);
    }
  }

  function runImport() {
    if (!canImport) return;
    setInputError(null);
    startTransition(async () => {
      try {
        const outcome = await importRowsAction(projectId, text);
        if (!outcome.ok) setInputError(outcome.error);
        else setResult({ created: outcome.created, skipped: outcome.skipped, errors: outcome.errors });
      } catch {
        setInputError("The import did not finish. Check your connection; rows already added stay in the sheet.");
      }
    });
  }

  function reset() {
    setText("");
    setFileName(null);
    setResult(null);
    setInputError(null);
  }

  function requestClose() {
    if (pending) return;
    if (!result && text.trim() && !window.confirm("Close without importing?")) return;
    onClose();
  }

  const importLabel = rows.length ? `Import ${plural(rows.length, "venue")}` : "Import";

  return (
    <Sheet
      open
      onClose={requestClose}
      variant="panel"
      title="Import venues"
      className="md:w-[min(44rem,100vw)]"
      primary={result ? undefined : { label: "Import", onClick: runImport, disabled: !canImport, pending }}
      footer={
        result ? (
          <>
            <Button variant="ghost" onClick={reset}>
              Import more
            </Button>
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={requestClose} disabled={pending}>
              Cancel
            </Button>
            <Button variant="primary" onClick={runImport} disabled={!canImport}>
              {pending ? "Importing…" : importLabel}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <ImportSummary result={result} onMore={reset} />
      ) : (
        <div className="flex flex-col gap-4" aria-busy={pending}>
          <p className="text-[13px] leading-relaxed text-muted md:text-xs">
            First line = column names, in Spanish or English: Sala / Municipio / Venue, Localidad / Concejo / City (Municipio next to a Sala is
            the city), Espacios, Contacto, Cargo, Email, Teléfono, WhatsApp, Web, Sección, Estado, Fechas, Caché, Seguimiento, Siguiente paso,
            Notas, Previo. Separated by ; , or tabs (paste straight from Excel or Google Sheets).
          </p>

          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <label htmlFor={`${id}-file`} className={buttonClass("secondary", "md", "cursor-pointer")}>
              <FileUp className="size-4" /> Choose a .csv or .tsv file
            </label>
            <input
              id={`${id}-file`}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
              onChange={pickFile}
              className="sr-only"
            />
            <button
              type="button"
              onClick={downloadExample}
              className="inline-flex h-10 items-center justify-center gap-1.5 text-[15px] text-muted active:opacity-60 md:h-auto md:justify-start md:text-xs md:hover:text-fg"
            >
              <Download className="size-3.5" aria-hidden /> Example file
            </button>
            {fileName ? <span className="truncate text-sm text-muted md:ml-auto md:text-xs">{fileName}</span> : null}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-text`} className="text-xs font-medium text-muted">
              {fileName ? "File contents" : "Or paste the rows"}
            </label>
            <Textarea
              id={`${id}-text`}
              rows={7}
              value={text}
              spellCheck={false}
              placeholder={EXAMPLE.split("\r\n").slice(0, 2).join("\n")}
              onChange={(e) => {
                setText(e.target.value);
                setFileName(null);
                setInputError(null);
              }}
              className="font-mono leading-snug md:text-xs"
            />
          </div>

          {inputError ? (
            <p role="alert" className="text-sm text-danger">
              {inputError}
            </p>
          ) : null}

          {parsed ? (
            <section aria-label="Preview" aria-live="polite" className={cn("flex flex-col gap-3", stale && "opacity-60")}>
              {inputProblem ? (
                <p className="text-sm text-danger">{inputProblem.message}</p>
              ) : (
                <>
                  <p className="text-sm text-fg">
                    <span className="font-medium">{plural(rows.length, "venue")}</span> ready
                    {errors.length ? <span className="text-danger"> · {plural(errors.length, "problem")}</span> : null}
                    <span className="text-muted"> · separated by {DELIMITERS[parsed.delimiter]}</span>
                  </p>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-muted">Columns found</span>
                    <div className="flex flex-wrap gap-1">
                      {parsed.columns.map((c) => (
                        <Badge key={c}>{FIELD_LABELS[c]}</Badge>
                      ))}
                    </div>
                    {parsed.ignored.length ? (
                      <p className="text-xs text-subtle">Ignored (not recognized): {parsed.ignored.join(", ")}</p>
                    ) : null}
                    {repeated > 0 ? (
                      <p className="text-xs text-warning">
                        {plural(repeated, "column")} repeat{repeated === 1 ? "s" : ""} a field an earlier column already fills (e.g. Sala and Organización
                        both name the venue) and {repeated === 1 ? "is" : "are"} skipped. Rename it (City, Notes…) to keep it.
                      </p>
                    ) : null}
                  </div>
                </>
              )}

              {rows.length ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted">
                    {rows.length > PREVIEW_ROWS ? `First ${PREVIEW_ROWS} of ${rows.length}` : "Rows"}
                  </span>
                  <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg">
                    {rows.slice(0, PREVIEW_ROWS).map((row) => (
                      <PreviewItem key={row.line} row={row} />
                    ))}
                  </ul>
                </div>
              ) : null}

              {importSections.length ? (
                <p className="text-xs text-muted">
                  Sections: {importSections.join(", ")}
                  {newSections.length ? <span className="text-subtle"> · new in this sheet: {newSections.join(", ")}</span> : null}
                </p>
              ) : null}
              {unread ? (
                <p className="text-xs text-muted">
                  {plural(unread, "row")} with a value that could not be read (an email, phone, status, fee or date): it is kept in the notes.
                </p>
              ) : null}

              {errors.length && !inputProblem ? <ErrorList errors={errors} title="Will not be imported" /> : null}
              <p className="text-xs text-subtle">
                Up to {IMPORT_MAX_ROWS} rows at a time. Venues already in this sheet with the same email are skipped. Contacts that already
                exist are linked, not duplicated.
              </p>
            </section>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}

function PreviewItem({ row }: { row: ParsedImportRow }) {
  const contact = [row.contactName, row.role].filter(Boolean).join(" · ");
  const reach = [row.email, row.phone, row.whatsapp && row.whatsapp !== row.phone ? `WhatsApp ${row.whatsapp}` : null].filter(Boolean).join(" · ");
  return (
    <li className="flex min-w-0 flex-col gap-0.5 px-4 py-2.5 md:px-3 md:py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="min-w-0 truncate text-[15px] font-medium text-fg md:text-sm">{row.organization}</span>
        {row.city ? <span className="text-[13px] text-muted md:text-xs">{row.city}</span> : null}
        {row.stage ? <StageBadge stage={row.stage} label={stageLabel(row.stage, row.kind ?? "booking")} /> : null}
        {row.returning ? <Badge>Returning</Badge> : null}
        {row.section ? <Badge className="font-normal">{row.section}</Badge> : null}
      </div>
      {contact ? <p className="truncate text-[13px] text-fg md:text-xs">{contact}</p> : null}
      {reach ? <p className="truncate text-[13px] text-muted md:text-xs">{reach}</p> : null}
      {row.spaces ? <p className="truncate text-[13px] text-subtle md:text-xs">{row.spaces}</p> : null}
    </li>
  );
}

function ErrorList({ errors, title }: { errors: { line: number; message: string }[]; title: string }) {
  const shown = errors.slice(0, 20);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted">{title}</span>
      <ul className="flex flex-col gap-1 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-[13px] text-red-800 md:rounded-lg md:px-3 md:py-2 md:text-xs dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        {shown.map((e, i) => (
          <li key={`${e.line}-${i}`}>
            {e.line > 0 ? <span className="font-medium">Line {e.line}: </span> : null}
            {e.message}
          </li>
        ))}
        {errors.length > shown.length ? <li className="opacity-80">…and {errors.length - shown.length} more</li> : null}
      </ul>
    </div>
  );
}

function ImportSummary({ result, onMore }: { result: ImportResult; onMore: () => void }) {
  return (
    <div className="flex flex-col gap-4" role="status">
      <div
        className={cn(
          "rounded-xl border px-4 py-3 md:rounded-lg",
          result.created
            ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
            : "border-border bg-surface-2 text-muted",
        )}
      >
        <p className="text-[15px] font-medium md:text-sm">
          {result.created ? `Added ${plural(result.created, "venue")} to the sheet.` : "No venues were added."}
        </p>
        {result.skipped ? <p className="mt-0.5 text-sm">{plural(result.skipped, "row")} skipped.</p> : null}
      </div>
      {result.errors.length ? <ErrorList errors={result.errors} title="Skipped rows" /> : null}
      <Button variant="secondary" onClick={onMore} className="w-full md:hidden">
        Import more
      </Button>
    </div>
  );
}
