/**
 * Import venues into a booking sheet from pasted text or a .csv / .tsv file
 * (client and server: the dialog previews with the same parser the server
 * imports with). Pure: no database.
 *
 * The first non-empty line is the header. Columns are recognized by name in
 * Spanish or English, case and accents ignored ("Teléfono" = "telefono" =
 * "Phone"); the others are ignored. The delimiter (; , or tab) is detected
 * from the header line.
 */
import { normalizeFee } from "@/lib/booking/fee";
import { normalizePhone } from "@/lib/booking/phone";
import type { SheetRowInput } from "@/lib/booking/types";
import { GOAL_KINDS, NEXT_ACTIONS, STAGE_LABELS_BY_KIND } from "@/lib/constants";
import type { NextAction, OpportunityKind, OpportunityStage } from "@/lib/types";
import { isValidEmail, normalizeEmail } from "@/lib/utils";

export const IMPORT_MAX_ROWS = 1000;
export const IMPORT_MAX_BYTES = 1_000_000;

export type ImportField = keyof SheetRowInput;

export interface ParsedImportRow extends SheetRowInput {
  /** Line of the input where the row starts (1-based; the header is a line too). */
  line: number;
}

export interface SheetImport {
  rows: ParsedImportRow[];
  /** Rows that cannot be imported (and input-level problems, line 0). */
  errors: { line: number; message: string }[];
  /** Recognized fields, in column order (e.g. ["organization", "city", "email"]). */
  columns: ImportField[];
  /** Header cells that were not recognized (their columns are ignored). */
  ignored: string[];
  delimiter: "," | ";" | "\t";
}

/** Header words per field, normalized (lower case, no accents, punctuation → spaces). */
const SYNONYMS: Record<ImportField, string[]> = {
  organization: [
    "venue",
    "sala",
    "espacio principal",
    "municipio",
    "organizacion",
    "organization",
    "organisation",
    "presenter",
    "venue presenter",
    "entidad",
  ],
  city: ["city", "ciudad", "localidad", "concejo", "town"],
  spaces: ["spaces", "espacios", "salas", "halls"],
  contactName: ["contact", "contacto", "nombre", "contact name", "nombre contacto", "nombre del contacto", "persona de contacto", "name"],
  role: ["role", "cargo", "puesto", "title"],
  email: ["email", "correo", "e mail", "correo electronico", "mail", "email address", "emails"],
  phone: ["phone", "telefono", "tel", "telefonos", "movil", "mobile", "phone number", "telefono movil"],
  whatsapp: ["whatsapp", "wa", "whats app"],
  website: ["website", "web", "url", "pagina web", "sitio web"],
  section: ["section", "seccion", "categoria", "category", "grupo", "group"],
  stage: ["status", "estado", "stage", "etapa"],
  eventDates: ["dates", "fechas", "fecha", "date"],
  fee: ["fee", "cache", "cachet", "importe", "honorarios", "precio"],
  followUpAt: ["follow up", "seguimiento", "followup", "fecha seguimiento", "proximo seguimiento"],
  nextAction: ["next action", "accion", "siguiente accion", "proxima accion"],
  nextStep: ["next step", "siguiente paso", "proximo paso"],
  kind: ["goal", "goal type", "objetivo", "tipo de objetivo"],
  notes: ["notes", "notas", "nota", "note", "observaciones", "comentarios"],
  returning: ["returning", "previo", "repetidor", "worked before"],
};

const STATUS_WORDS: Record<string, OpportunityStage> = {
  pendiente: "lead",
  "to contact": "lead",
  lead: "lead",
  "por contactar": "lead",
  "sin contactar": "lead",
  "email enviado": "contacted",
  "correo enviado": "contacted",
  llamado: "contacted",
  contactado: "contacted",
  contacted: "contacted",
  "sin respuesta": "contacted",
  "no reply": "contacted",
  propuesta: "proposal",
  "propuesta enviada": "proposal",
  "oferta enviada": "proposal",
  "offer sent": "proposal",
  proposal: "proposal",
  "en conversacion": "negotiation",
  "in conversation": "negotiation",
  negotiation: "negotiation",
  negotiating: "negotiation",
  negociacion: "negotiation",
  "en negociacion": "negotiation",
  confirmado: "won",
  confirmada: "won",
  confirmed: "won",
  won: "won",
  rechazado: "lost",
  rechazada: "lost",
  declined: "lost",
  lost: "lost",
  descartado: "lost",
};

/** Every stage name of every goal kind ("Granted", "Published"…) reads back as its stage. */
for (const labels of Object.values(STAGE_LABELS_BY_KIND)) {
  for (const [stage, label] of Object.entries(labels) as [OpportunityStage, string][]) {
    STATUS_WORDS[normalizeHeader(label)] ??= stage;
  }
}

/**
 * Next steps as the owner writes them (normalized: lower case, no accents).
 * Matched as whole words, longest first, after the exact English labels and
 * values ("Send full proposal", "send_proposal").
 */
const NEXT_ACTION_WORDS: [string, NextAction][] = [
  ["mantener informado", "keep_informed"],
  ["mantenerles informados", "keep_informed"],
  ["mantener informados", "keep_informed"],
  ["firmar contrato", "close_contract"],
  ["firmar el contrato", "close_contract"],
  ["cerrar contrato", "close_contract"],
  ["cerrar el contrato", "close_contract"],
  ["enviar contrato", "send_contract"],
  ["enviar el contrato", "send_contract"],
  ["primer contacto", "first_contact"],
  ["videollamada", "meeting"],
  ["reunion", "meeting"],
  ["llamar", "call"],
  ["llamada", "call"],
  ["telefonear", "call"],
  ["propuesta", "send_proposal"],
  ["contrato", "send_contract"],
  ["seguimiento", "follow_up"],
  ["recordatorio", "follow_up"],
  ["informar", "keep_informed"],
  ["novedades", "keep_informed"],
  ["esperar", "wait_reply"],
  ["esperando", "wait_reply"],
  ["dossier", "send_materials"],
  ["video", "send_materials"],
  ["material", "send_materials"],
  ["materiales", "send_materials"],
  ["fechas", "agree_terms"],
  ["cache", "agree_terms"],
  ["condiciones", "agree_terms"],
  ["logistica", "logistics"],
  ["factura", "invoice"],
  ["facturar", "invoice"],
  ["agradecer", "thank_report"],
  ["gracias", "thank_report"],
  ["fotos", "thank_report"],
  ["contactar", "first_contact"],
  ["call", "call"],
  ["meeting", "meeting"],
  ["proposal", "send_proposal"],
  ["contract", "send_contract"],
  ["follow up", "follow_up"],
  ["invoice", "invoice"],
  ["wait", "wait_reply"],
];

const NEXT_ACTION_EXACT = new Map<string, NextAction>(
  NEXT_ACTIONS.flatMap((a) => [
    [normalizeHeader(a.label), a.value],
    [normalizeHeader(a.value), a.value],
  ]),
);

/**
 * A next step cell → the action, and whether the cell said more than the
 * action itself ("Llamar" → call; "Llamar a Ana el lunes" → call + detail).
 * Null when nothing matches.
 */
export function parseImportNextAction(value: string): { action: NextAction; exact: boolean } | null {
  const text = normalizeHeader(value);
  if (!text) return null;
  const exact = NEXT_ACTION_EXACT.get(text);
  if (exact) return { action: exact, exact: true };
  const padded = ` ${text} `;
  for (const [words, action] of NEXT_ACTION_WORDS) {
    if (padded.includes(` ${words} `)) return { action, exact: text === words };
  }
  return null;
}

/** Goal kinds as the owner writes them (normalized), after the English labels and values. */
const KIND_WORDS: [string, OpportunityKind][] = [
  ["concierto", "booking"],
  ["contratacion", "booking"],
  ["actuacion", "booking"],
  ["bolo", "booking"],
  ["tocar juntos", "perform_with"],
  ["residencia", "residency"],
  ["taller", "education"],
  ["masterclass", "education"],
  ["educacion", "education"],
  ["grabacion", "broadcast"],
  ["radio", "broadcast"],
  ["television", "broadcast"],
  ["streaming", "broadcast"],
  ["cesion", "venue"],
  ["espacio", "venue"],
  ["sala", "venue"],
  ["intercambio", "exchange"],
  ["donacion", "fundraising"],
  ["donativo", "fundraising"],
  ["mecenazgo", "fundraising"],
  ["patrocinio", "sponsorship"],
  ["subvencion", "grant"],
  ["ayuda", "grant"],
  ["beca", "grant"],
  ["colaboracion", "partnership"],
  ["coproduccion", "coproduction"],
  ["encargo", "coproduction"],
  ["circuito", "network"],
  ["catalogo", "network"],
  ["red", "network"],
  ["presentacion", "introduction"],
  ["introduccion", "introduction"],
  ["prensa", "press"],
  ["entrevista", "press"],
  ["venta", "sale"],
  ["otro", "other"],
];

const KIND_EXACT = new Map<string, OpportunityKind>(
  GOAL_KINDS.flatMap((k) => [
    [normalizeHeader(k.label), k.value],
    [normalizeHeader(k.value), k.value],
  ]),
);

export function parseImportKind(value: string): OpportunityKind | null {
  const text = normalizeHeader(value);
  if (!text) return null;
  const exact = KIND_EXACT.get(text);
  if (exact) return exact;
  const padded = ` ${text} `;
  return KIND_WORDS.find(([words]) => padded.includes(` ${words} `))?.[1] ?? null;
}

const YES = new Set(["si", "yes", "y", "s", "x", "true", "1", "✓", "✔", "previo", "returning"]);

/** Lower case, accents stripped, parentheses dropped, punctuation → single spaces. */
export function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9✓✔]+/g, " ")
    .trim();
}

const FIELD_BY_HEADER = new Map<string, ImportField>(
  (Object.entries(SYNONYMS) as [ImportField, string[]][]).flatMap(([field, words]) => words.map((w) => [w, field] as const)),
);

function detectDelimiter(firstLine: string): SheetImport["delimiter"] {
  const counts = { "\t": 0, ";": 0, ",": 0 };
  let quoted = false;
  for (const ch of firstLine) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in counts) counts[ch as keyof typeof counts]++;
  }
  if (counts["\t"] && counts["\t"] >= counts[";"] && counts["\t"] >= counts[","]) return "\t";
  if (counts[";"] && counts[";"] >= counts[","]) return ";";
  return ",";
}

/** RFC 4180-style records: quoted cells may hold delimiters, newlines and "" for a quote. */
function parseRecords(text: string, delimiter: string): { cells: string[]; line: number }[] {
  const records: { cells: string[]; line: number }[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let atCellStart = true;
  let line = 1;
  let recordLine = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && atCellStart) {
      quoted = true;
      atCellStart = false;
    } else if (ch === delimiter) {
      cells.push(cell);
      cell = "";
      atCellStart = true;
    } else if (ch === "\n") {
      cells.push(cell);
      records.push({ cells, line: recordLine });
      cells = [];
      cell = "";
      atCellStart = true;
      line++;
      recordLine = line;
    } else {
      cell += ch;
      if (ch !== " ") atCellStart = false;
    }
  }
  if (cell !== "" || cells.length) {
    cells.push(cell);
    records.push({ cells, line: recordLine });
  }
  return records;
}

/** "2026-10-15", "15/10/2026", "15-10-26", "15.10.2026" → 'YYYY-MM-DD' (day first unless that is impossible). */
export function parseImportDate(value: string): string | null {
  const s = value.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
    if (!match) return null;
    let [a, b] = [Number(match[1]), Number(match[2])];
    y = Number(match[3]);
    if (y < 100) y += 2000;
    if (b > 12 && a <= 12) [a, b] = [b, a]; // month first (US)
    [d, m] = [a, b];
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

export function parseImportStage(value: string): OpportunityStage | null {
  return STATUS_WORDS[normalizeHeader(value)] ?? null;
}

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Several values in one cell ("a@x.es, b@y.es", "985 11 22 33 / 600 111 222"). */
function splitMulti(value: string): string[] {
  return value
    .split(/[,;/\n]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

export function parseSheetImport(text: string): SheetImport {
  const result: SheetImport = { rows: [], errors: [], columns: [], ignored: [], delimiter: "," };
  if (new TextEncoder().encode(text).length > IMPORT_MAX_BYTES) {
    result.errors.push({ line: 0, message: "The text is larger than 1 MB. Split it into smaller files." });
    return result;
  }
  const normalized = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const firstLine = normalized.split("\n").find((l) => l.trim() !== "") ?? "";
  if (!firstLine) {
    result.errors.push({ line: 0, message: "Nothing to import: paste a header line and one line per venue." });
    return result;
  }
  result.delimiter = detectDelimiter(firstLine);
  const records = parseRecords(normalized, result.delimiter).filter((r) => r.cells.some((c) => c.trim() !== ""));
  const [header, ...data] = records;

  const fields: (ImportField | null)[] = header.cells.map((cell) => {
    const field = FIELD_BY_HEADER.get(normalizeHeader(cell)) ?? null;
    if (!field && cell.trim()) result.ignored.push(cell.trim());
    return field;
  });
  // "Sala" + "Municipio": the venue is the hall, and the municipality is its
  // city (unless a city column exists too).
  const isMunicipio = (i: number) => normalizeHeader(header.cells[i]) === "municipio";
  if (fields.some((f, i) => f === "organization" && !isMunicipio(i)) && !fields.includes("city")) {
    const i = fields.findIndex((f, j) => f === "organization" && isMunicipio(j));
    if (i !== -1) fields[i] = "city";
  }
  // A field named twice: the first column wins.
  fields.forEach((field, i) => {
    if (field && fields.indexOf(field) !== i) fields[i] = null;
  });
  result.columns = fields.filter((f): f is ImportField => f !== null);
  if (!result.columns.includes("organization")) {
    result.errors.push({
      line: header.line,
      message: "No venue column: the first line must name the columns, with one called Venue, Sala, Municipio or Organization.",
    });
    return result;
  }

  for (const [index, record] of data.entries()) {
    if (index >= IMPORT_MAX_ROWS) {
      result.errors.push({ line: record.line, message: `Only ${IMPORT_MAX_ROWS} rows can be imported at a time; the rest were skipped.` });
      break;
    }
    const get = (field: ImportField) => {
      const i = fields.indexOf(field);
      return i === -1 ? "" : (record.cells[i] ?? "").trim();
    };
    const extraNotes: string[] = [];
    const row: ParsedImportRow = { line: record.line, organization: clip(oneLine(get("organization")), 300) };
    if (!row.organization) {
      result.errors.push({ line: record.line, message: "No venue / presenter name." });
      continue;
    }

    const text = (field: Exclude<ImportField, "organization">, max = 300) => {
      const value = clip(oneLine(get(field)), max);
      return value || null;
    };
    row.city = text("city");
    row.spaces = text("spaces", 1000);
    row.section = text("section", 120);
    row.contactName = text("contactName");
    row.role = text("role");
    row.website = text("website", 500);
    row.eventDates = text("eventDates");
    row.nextStep = text("nextStep");

    const action = get("nextAction");
    if (action) {
      const parsed = parseImportNextAction(action);
      if (parsed) row.nextAction = parsed.action;
      // What the cell says beyond the action itself is the next step's detail.
      if (!parsed || !parsed.exact) {
        if (!row.nextStep) row.nextStep = clip(oneLine(action), 300);
        else extraNotes.push(`Next action: ${oneLine(action)}`);
      }
    }

    const goal = get("kind");
    if (goal) {
      const kind = parseImportKind(goal);
      if (kind) row.kind = kind;
      else extraNotes.push(`Goal: ${oneLine(goal)}`);
    }

    const emails = splitMulti(get("email").replace(/\s+/g, ","));
    const valid = emails.map(normalizeEmail).filter(isValidEmail);
    if (valid.length) {
      row.email = valid[0];
      const others = [...new Set(valid.slice(1))].filter((e) => e !== valid[0]);
      if (others.length) extraNotes.push(`Other emails: ${others.join(", ")}`);
    }
    const invalid = emails.filter((e) => !isValidEmail(normalizeEmail(e)));
    if (invalid.length) extraNotes.push(`Email (not valid): ${invalid.join(", ")}`);

    const isPhone = (value: string) => normalizePhone(value) !== null || normalizePhone(value, "+1") !== null;
    const phones = splitMulti(get("phone"));
    const goodPhones = phones.filter(isPhone);
    if (goodPhones.length) {
      row.phone = goodPhones[0];
      if (goodPhones.length > 1) extraNotes.push(`Other phones: ${goodPhones.slice(1).join(", ")}`);
    }
    const badPhones = phones.filter((p) => !isPhone(p));
    if (badPhones.length) extraNotes.push(`Phone: ${badPhones.join(", ")}`);

    const whatsapps = splitMulti(get("whatsapp"));
    if (whatsapps[0] && isPhone(whatsapps[0])) row.whatsapp = whatsapps[0];
    else if (whatsapps[0]) extraNotes.push(`WhatsApp: ${whatsapps.join(", ")}`);
    if (whatsapps.length > 1 && row.whatsapp) extraNotes.push(`Other WhatsApp: ${whatsapps.slice(1).join(", ")}`);

    const status = get("stage");
    if (status) {
      const stage = parseImportStage(status);
      if (stage) row.stage = stage;
      else extraNotes.push(`Status: ${oneLine(status)}`);
    }

    const fee = get("fee");
    if (fee) {
      const amount = normalizeFee(fee);
      if (amount !== null) row.fee = amount;
      else extraNotes.push(`Fee: ${oneLine(fee)}`);
    }

    const followUp = get("followUpAt");
    if (followUp) {
      const date = parseImportDate(followUp);
      if (date) row.followUpAt = date;
      else extraNotes.push(`Follow up: ${oneLine(followUp)}`);
    }

    const returning = get("returning");
    if (returning) row.returning = YES.has(normalizeHeader(returning)) || YES.has(returning.trim().toLowerCase());

    const notes = [get("notes"), ...extraNotes].filter(Boolean).join("\n");
    row.notes = notes ? clip(notes, 20_000) : null;

    result.rows.push(row);
  }
  return result;
}
