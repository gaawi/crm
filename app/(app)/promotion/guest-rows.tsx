"use client";

import Link from "next/link";
import { useId, useRef, useState, useTransition } from "react";
import { CheckCircle2, Circle, ClipboardPaste, Loader2, Minus, Pencil, Phone, Plus, Trash2 } from "lucide-react";
import { parseBuyerList } from "@/lib/guests/parse-list";
import { ContactAvatar } from "@/components/contact-avatar";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { ActionForm } from "../_components/action-form";
import { suggestRecipients, type RecipientSuggestion } from "../mail/actions";
import {
  addContactGuestAction,
  addGuestAction,
  checkInGuestAction,
  importBuyersAction,
  removeGuestAction,
  setGuestTicketsAction,
  updateGuestAction,
} from "./guest-actions";

export interface GuestRow {
  id: string;
  contactId: string | null;
  name: string;
  email: string | null;
  tickets: number;
  kindLabel: string;
  note: string | null;
  photoUrl: string | null;
  checkedIn: boolean;
}

type Done = { ok: true } | { ok: false; error: string };

/**
 * The concert's list as rows: tap the circle to check someone in at the door,
 * − / + for their tickets, the bin to take them off (two taps).
 */
export function GuestRows({ guests }: { guests: GuestRow[] }) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (key: string, action: () => Promise<Done>) => {
    setBusy(key);
    setError(null);
    start(async () => {
      const r = await action().catch(() => ({ ok: false as const, error: "Not saved. Try again." }));
      if (!r.ok) setError(r.error);
      setBusy(null);
      setConfirm(null);
    });
  };
  const spin = (key: string) => pending && busy === key;

  return (
    <>
      {error ? <p className="mb-2 px-4 text-[13px] text-danger md:px-0">{error}</p> : null}
      <ul className="overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg [&>li+li]:border-t [&>li+li]:border-border">
        {guests.map((g) => (
          <li key={g.id} className={cn("flex min-h-[60px] items-center gap-2 py-2 pl-2 pr-3 md:min-h-12", g.checkedIn && "bg-emerald-50/60 dark:bg-emerald-950/30")}>
            <button
              type="button"
              aria-label={g.checkedIn ? `${g.name} arrived: undo` : `Check in ${g.name}`}
              aria-pressed={g.checkedIn}
              disabled={pending}
              onClick={() => run(`${g.id}in`, () => checkInGuestAction(g.id, !g.checkedIn))}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full active:bg-surface-2 md:size-8"
            >
              {spin(`${g.id}in`) ? (
                <Loader2 className="size-5 animate-spin text-muted" />
              ) : g.checkedIn ? (
                <CheckCircle2 className="size-6 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Circle className="size-6 text-subtle" />
              )}
            </button>
            <PersonLink contactId={g.contactId}>
              <ContactAvatar contact={{ displayName: g.name, photoUrl: g.photoUrl }} size="sm" className="shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[17px] leading-snug text-fg md:text-sm">{g.name}</span>
                <span className="block truncate text-[13px] text-subtle md:text-xs">
                  {g.kindLabel}
                  {g.note ? ` · ${g.note}` : g.email ? ` · ${g.email}` : ""}
                </span>
              </span>
            </PersonLink>
            <span className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                aria-label="One ticket less"
                disabled={pending || g.tickets <= 1}
                onClick={() => run(`${g.id}-`, () => setGuestTicketsAction(g.id, g.tickets - 1))}
                className="inline-flex size-9 items-center justify-center rounded-full border border-border active:bg-surface-2 disabled:opacity-40 md:size-7"
              >
                <Minus className="size-4 md:size-3.5" />
              </button>
              <span className="w-7 text-center text-[17px] font-semibold tabular-nums md:text-sm">
                {spin(`${g.id}-`) || spin(`${g.id}+`) ? <Loader2 className="mx-auto size-4 animate-spin" /> : g.tickets}
              </span>
              <button
                type="button"
                aria-label="One ticket more"
                disabled={pending || g.tickets >= 20}
                onClick={() => run(`${g.id}+`, () => setGuestTicketsAction(g.id, g.tickets + 1))}
                className="inline-flex size-9 items-center justify-center rounded-full border border-border active:bg-surface-2 disabled:opacity-40 md:size-7"
              >
                <Plus className="size-4 md:size-3.5" />
              </button>
              <button
                type="button"
                aria-label={confirm === g.id ? `Tap again to remove ${g.name}` : `Remove ${g.name}`}
                disabled={pending}
                onClick={() => (confirm === g.id ? run(`${g.id}x`, () => removeGuestAction(g.id)) : setConfirm(g.id))}
                className={cn(
                  "ml-1 inline-flex size-9 items-center justify-center rounded-full active:bg-surface-2 md:size-7",
                  confirm === g.id ? "bg-red-600 text-white" : "text-subtle",
                )}
              >
                {spin(`${g.id}x`) ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4 md:size-3.5" />}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * "Add a guest" / "Add staff or artist": search first (contacts, then people
 * you have emailed). A guest who is a contact goes on the list with one tap,
 * linked to their card; staff open the form (role, phone, call time) with the
 * contact linked; anyone else opens the form with their name and address.
 */
export function AddGuestRow({
  eventId,
  kinds,
  mode = "guest",
}: {
  eventId: string;
  kinds: { value: string; label: string }[];
  mode?: "guest" | "staff";
}) {
  const staff = mode === "staff";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RecipientSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [tickets, setTickets] = useState(2);
  const [manual, setManual] = useState<{ name: string; email: string; contactId?: string } | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const id = useId();
  const formId = `${id}-guest`;

  const close = () => {
    setOpen(false);
    setQuery("");
    setResults([]);
    setManual(null);
    setTickets(2);
    setError(null);
  };

  const search = (value: string) => {
    setQuery(value);
    const q = value.trim();
    const mine = ++seq.current;
    if (!q) {
      setResults([]);
      return;
    }
    setSearching(true);
    setTimeout(async () => {
      if (mine !== seq.current) return;
      const found = await suggestRecipients(q).catch(() => []);
      if (mine !== seq.current) return;
      setResults(found);
      setSearching(false);
    }, 200);
  };

  const pick = (r: RecipientSuggestion) => {
    if (!r.contactId || staff) {
      setManual({ name: r.name ?? "", email: r.email, contactId: r.contactId ?? undefined });
      return;
    }
    setError(null);
    start(async () => {
      const done = await addContactGuestAction(eventId, r.contactId!, tickets).catch(() => ({ ok: false as const, error: "Not saved. Try again." }));
      if (done.ok) close();
      else setError(done.error);
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-[52px] w-full items-center gap-3 rounded-xl border border-border bg-surface px-4 text-left text-[17px] text-blue-600 active:bg-surface-2 md:min-h-11 md:rounded-lg md:text-sm dark:text-blue-400"
      >
        <Plus className="size-5" aria-hidden />
        {staff ? "Add staff or artist" : "Add a guest"}
      </button>
      {open ? (
        <Sheet open onClose={close} title={staff ? "Add staff or artist" : "Add a guest"} primary={manual ? { label: "Add", form: formId } : undefined}>
          {manual && staff ? (
            <ActionForm id={formId} action={addGuestAction.bind(null, eventId)} onDone={close} className="flex flex-col gap-3">
              <input type="hidden" name="contactId" value={manual.contactId ?? ""} />
              <input type="hidden" name="tickets" value="1" />
              <input type="hidden" name="email" value={manual.email} />
              <p className="text-[13px] text-muted md:text-xs">
                {manual.contactId ? "Linked to their contact: the phone comes from their card if you leave it empty." : "Not in your contacts: they go on the list by name."}
              </p>
              <PersonFields id={id} kinds={kinds} person={{ name: manual.name, kind: "staff" }} />
              <button type="button" onClick={() => setManual(null)} className="self-start text-[15px] text-blue-600 md:text-sm dark:text-blue-400">
                Back to search
              </button>
            </ActionForm>
          ) : manual ? (
            <ActionForm id={formId} action={addGuestAction.bind(null, eventId)} onDone={close} className="flex flex-col gap-3">
              <p className="text-[13px] text-muted md:text-xs">Not in your contacts: they go on the list by name.</p>
              <Field label="Name" htmlFor={`${id}-name`}>
                <Input id={`${id}-name`} name="name" required maxLength={200} autoComplete="off" defaultValue={manual.name} autoFocus />
              </Field>
              <Field label="Email (optional)" htmlFor={`${id}-email`}>
                <Input id={`${id}-email`} name="email" type="email" autoCapitalize="off" defaultValue={manual.email} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Tickets" htmlFor={`${id}-tickets`}>
                  <Input id={`${id}-tickets`} name="tickets" type="number" min={1} max={20} defaultValue={tickets} inputMode="numeric" />
                </Field>
                <Field label="Who" htmlFor={`${id}-kind`}>
                  <Select id={`${id}-kind`} name="kind" defaultValue="guest">
                    {kinds.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Note for the door (optional)" htmlFor={`${id}-note`}>
                <Textarea id={`${id}-note`} name="note" rows={2} maxLength={1000} />
              </Field>
              <button type="button" onClick={() => setManual(null)} className="self-start text-[15px] text-blue-600 md:text-sm dark:text-blue-400">
                Back to search
              </button>
            </ActionForm>
          ) : (
            <div className="flex flex-col gap-3">
              <Input
                type="search"
                autoFocus
                autoComplete="off"
                enterKeyHint="search"
                placeholder="Search contacts by name or email"
                aria-label="Search contacts"
                value={query}
                onChange={(e) => search(e.target.value)}
              />
              <div className={cn("flex items-center justify-between gap-3 text-[15px] md:text-sm", staff && "hidden")}>
                <span className="text-muted">Tickets</span>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="One ticket less"
                    disabled={tickets <= 1}
                    onClick={() => setTickets((t) => Math.max(1, t - 1))}
                    className="inline-flex size-9 items-center justify-center rounded-full border border-border disabled:opacity-40 md:size-7"
                  >
                    <Minus className="size-4" />
                  </button>
                  <span className="w-8 text-center text-[17px] font-semibold tabular-nums md:text-sm">{tickets}</span>
                  <button
                    type="button"
                    aria-label="One ticket more"
                    disabled={tickets >= 20}
                    onClick={() => setTickets((t) => Math.min(20, t + 1))}
                    className="inline-flex size-9 items-center justify-center rounded-full border border-border disabled:opacity-40 md:size-7"
                  >
                    <Plus className="size-4" />
                  </button>
                </span>
              </div>
              {error ? <p className="text-[13px] text-danger">{error}</p> : null}
              {query.trim() ? (
                <ul className="overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg [&>li+li]:border-t [&>li+li]:border-border">
                  {results.map((r) => (
                    <li key={`${r.contactId ?? ""}${r.email}`}>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => pick(r)}
                        className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left active:bg-surface-2 md:min-h-11 md:hover:bg-surface-2"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[17px] text-fg md:text-sm">{r.name ?? r.email}</span>
                          <span className="block truncate text-[13px] text-subtle md:text-xs">
                            {[r.organization, r.name ? r.email : null].filter(Boolean).join(" · ") || (r.contactId ? "Contact" : "Emailed before")}
                          </span>
                        </span>
                        {pending ? (
                          <Loader2 className="size-4 animate-spin text-muted" />
                        ) : r.contactId ? (
                          <span className="shrink-0 rounded-full bg-brand px-3 py-1 text-[13px] font-medium text-white md:text-xs">
                            {staff ? "Choose" : `Add · ${tickets}`}
                          </span>
                        ) : (
                          <span className="shrink-0 text-[13px] text-subtle md:text-xs">Not a contact</span>
                        )}
                      </button>
                    </li>
                  ))}
                  {!searching && !results.length ? <li className="px-4 py-3 text-[15px] text-muted md:text-sm">No contact matches.</li> : null}
                  <li>
                    <button
                      type="button"
                      onClick={() => setManual({ name: query.includes("@") ? "" : query.trim(), email: query.includes("@") ? query.trim() : "" })}
                      className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left text-[17px] text-blue-600 active:bg-surface-2 md:min-h-11 md:text-sm dark:text-blue-400"
                    >
                      <Plus className="size-5" aria-hidden />
                      Add “{query.trim()}” {staff ? "by name" : "as a new guest"}
                    </button>
                  </li>
                </ul>
              ) : (
                <p className="text-[13px] text-muted md:text-xs">Type a name: contacts appear first, then people you have emailed.</p>
              )}
            </div>
          )}
        </Sheet>
      ) : null}
    </>
  );
}

/** Name, who they are, role, phone, call time and a note: the fields of a staff member or artist. */
function PersonFields({
  id,
  kinds,
  person,
}: {
  id: string;
  kinds: { value: string; label: string }[];
  person: { name?: string; kind?: string; role?: string | null; phone?: string | null; callTime?: string | null; note?: string | null; backup?: boolean };
}) {
  return (
    <>
      <Field label="Name" htmlFor={`${id}-name`}>
        <Input id={`${id}-name`} name="name" required maxLength={200} autoComplete="off" defaultValue={person.name ?? ""} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Who" htmlFor={`${id}-kind`}>
          <Select id={`${id}-kind`} name="kind" defaultValue={person.kind ?? "staff"}>
            {kinds.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Call time" htmlFor={`${id}-call`}>
          <Input id={`${id}-call`} name="callTime" type="time" defaultValue={person.callTime ?? ""} />
        </Field>
      </div>
      <Field label="Role" htmlFor={`${id}-role`}>
        <Input id={`${id}-role`} name="role" maxLength={100} placeholder="Camera, usher, violin…" defaultValue={person.role ?? ""} />
      </Field>
      <Field label="Phone" htmlFor={`${id}-phone`}>
        <Input id={`${id}-phone`} name="phone" type="tel" inputMode="tel" maxLength={40} placeholder="From their contact card if empty" defaultValue={person.phone ?? ""} />
      </Field>
      <Field label="Note (optional)" htmlFor={`${id}-note`}>
        <Textarea id={`${id}-note`} name="note" rows={2} maxLength={1000} placeholder="Brings the camera, parks nearby…" defaultValue={person.note ?? ""} />
      </Field>
      <input type="hidden" name="backupField" value="1" />
      <label className="flex min-h-11 items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-[15px] text-fg md:min-h-9 md:rounded-lg md:text-sm">
        <Checkbox name="backup" defaultChecked={person.backup ?? false} />
        <span className="flex-1">
          Backup
          <span className="block text-[13px] text-subtle md:text-xs">Only comes if needed. Listed apart, not counted.</span>
        </span>
      </label>
    </>
  );
}

export interface StaffRow {
  id: string;
  contactId: string | null;
  name: string;
  kind: string;
  kindLabel: string;
  role: string | null;
  phone: string | null;
  callTime: string | null;
  note: string | null;
  backup: boolean;
  photoUrl: string | null;
  checkedIn: boolean;
}

/**
 * Who someone is on a list: tapping a person in the CRM opens their full
 * contact card over the list (closing it comes back here).
 */
function PersonLink({ contactId, children }: { contactId: string | null; children: React.ReactNode }) {
  if (!contactId) return <span className="flex min-w-0 flex-1 items-center gap-2.5">{children}</span>;
  return (
    <Link href={`/contacts/${contactId}`} scroll={false} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg active:opacity-70">
      {children}
    </Link>
  );
}

function StaffWho({ s }: { s: StaffRow }) {
  return (
    <>
      <ContactAvatar contact={{ displayName: s.name, photoUrl: s.photoUrl }} size="sm" className="shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[17px] leading-snug text-fg md:text-sm">{s.name}</span>
        <span className="block truncate text-[13px] text-subtle md:text-xs">{[s.role || s.kindLabel, s.note].filter(Boolean).join(" · ")}</span>
      </span>
    </>
  );
}

/** "17:00" as "5:00 PM". */
function clock(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/**
 * Staff and artists of the concert, by call time: check them in, call them,
 * tap the row to change their role, phone, time or note (or remove them).
 */
export function StaffRows({ staff, kinds }: { staff: StaffRow[]; kinds: { value: string; label: string }[] }) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const formId = `${id}-staff`;

  const checkIn = (s: StaffRow) => {
    setBusy(s.id);
    start(async () => {
      const r = await checkInGuestAction(s.id, !s.checkedIn).catch(() => ({ ok: false as const, error: "Not saved. Try again." }));
      if (!r.ok) setError(r.error);
      setBusy(null);
    });
  };

  return (
    <>
      {error ? <p className="mb-2 px-4 text-[13px] text-danger md:px-0">{error}</p> : null}
      <ul className="overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg [&>li+li]:border-t [&>li+li]:border-border">
        {staff.map((s) => (
          <li key={s.id} className={cn("flex min-h-[60px] items-center gap-2 py-2 pl-2 pr-3 md:min-h-12", s.checkedIn && "bg-emerald-50/60 dark:bg-emerald-950/30")}>
            <button
              type="button"
              aria-label={s.checkedIn ? `${s.name} arrived: undo` : `Check in ${s.name}`}
              aria-pressed={s.checkedIn}
              disabled={pending}
              onClick={() => checkIn(s)}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full active:bg-surface-2 md:size-8"
            >
              {pending && busy === s.id ? (
                <Loader2 className="size-5 animate-spin text-muted" />
              ) : s.checkedIn ? (
                <CheckCircle2 className="size-6 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Circle className="size-6 text-subtle" />
              )}
            </button>
            {s.contactId ? (
              <PersonLink contactId={s.contactId}>
                <StaffWho s={s} />
              </PersonLink>
            ) : (
              <button type="button" onClick={() => setEditing(s)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                <StaffWho s={s} />
              </button>
            )}
            {s.callTime ? (
              <span className="shrink-0 rounded-full bg-surface-2 px-2.5 py-1 text-[13px] font-semibold tabular-nums text-fg md:text-xs">{clock(s.callTime)}</span>
            ) : null}
            {s.contactId ? (
              <button
                type="button"
                aria-label={`Edit ${s.name}`}
                onClick={() => setEditing(s)}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-subtle active:bg-surface-2 md:size-8"
              >
                <Pencil className="size-4" />
              </button>
            ) : null}
            {s.phone ? (
              <a
                href={`tel:${s.phone.replace(/[^\d+]/g, "")}`}
                aria-label={`Call ${s.name}`}
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white active:opacity-80 md:size-8"
              >
                <Phone className="size-4" />
              </a>
            ) : null}
          </li>
        ))}
      </ul>
      {editing ? (
        <Sheet
          open
          onClose={() => {
            setEditing(null);
            setConfirm(false);
          }}
          title={editing.name}
          primary={{ label: "Save", form: formId }}
        >
          <ActionForm
            id={formId}
            action={updateGuestAction.bind(null, editing.id)}
            onDone={() => setEditing(null)}
            className="flex flex-col gap-3"
          >
            <PersonFields id={id} kinds={kinds} person={editing} />
            {editing.contactId ? (
              <Link href={`/contacts/${editing.contactId}`} className="self-start text-[15px] text-blue-600 md:text-sm dark:text-blue-400">
                Open their contact
              </Link>
            ) : null}
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                confirm
                  ? start(async () => {
                      await removeGuestAction(editing.id).catch(() => null);
                      setEditing(null);
                      setConfirm(false);
                    })
                  : setConfirm(true)
              }
              className={cn(
                "mt-2 flex min-h-11 items-center justify-center gap-2 rounded-xl border text-[15px] md:min-h-9 md:text-sm",
                confirm ? "border-red-600 bg-red-600 text-white" : "border-border text-danger",
              )}
            >
              <Trash2 className="size-4" aria-hidden />
              {confirm ? "Tap again to remove" : "Remove from this concert"}
            </button>
          </ActionForm>
        </Sheet>
      ) : null}
    </>
  );
}

/**
 * "Paste a ticket list": the list Eventbrite, PipTix, TDF… send on the day
 * (copied from their email or spreadsheet), one buyer per line. Shows how many
 * names it found before adding them.
 */
export function PasteListButton({ eventId, channels }: { eventId: string; channels: string[] }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [source, setSource] = useState(channels[0] ?? "__other");
  const id = useId();
  const formId = `${id}-paste`;
  const found = parseBuyerList(text);
  const tickets = found.reduce((n, b) => n + b.tickets, 0);
  const close = () => {
    setOpen(false);
    setText("");
  };
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-[52px] w-full items-center gap-3 rounded-xl border border-border bg-surface px-4 text-left text-[17px] text-blue-600 active:bg-surface-2 md:min-h-11 md:rounded-lg md:text-sm dark:text-blue-400"
      >
        <ClipboardPaste className="size-5" aria-hidden />
        Paste a ticket list (Eventbrite, PipTix…)
      </button>
      {open ? (
        <Sheet open onClose={close} title="Paste a ticket list" primary={{ label: "Add", form: formId }}>
          <ActionForm id={formId} action={importBuyersAction.bind(null, eventId)} onDone={close} className="flex flex-col gap-3">
            <Field label="From" htmlFor={`${id}-source`}>
              <Select id={`${id}-source`} name="source" value={source} onChange={(e) => setSource(e.target.value)}>
                {channels.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value="__other">Other…</option>
              </Select>
            </Field>
            {source === "__other" ? (
              <Field label="Channel name" htmlFor={`${id}-other`}>
                <Input id={`${id}-other`} name="otherSource" required maxLength={80} placeholder="Goldstar, at the door…" />
              </Field>
            ) : null}
            <Field label="The list" htmlFor={`${id}-list`}>
              <Textarea
                id={`${id}-list`}
                name="list"
                rows={10}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={"One person per line, with their tickets:\nAna López, 2\nJohn Smith  john@x.com  3"}
                className="font-mono text-[13px]"
              />
            </Field>
            <p className="text-[13px] text-muted md:text-xs">
              {found.length
                ? `${found.length} ${found.length === 1 ? "name" : "names"} · ${tickets} ${tickets === 1 ? "ticket" : "tickets"} found.`
                : "Copy the list from their email or spreadsheet and paste it here."}
            </p>
            <label className="flex items-center gap-3 text-[15px] md:text-sm">
              <Checkbox name="replace" defaultChecked />
              Replace the earlier list from this channel
            </label>
          </ActionForm>
        </Sheet>
      ) : null}
    </>
  );
}
