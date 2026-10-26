"use client";

import Link from "next/link";
import { useId, useRef, useState, useTransition } from "react";
import { CheckCircle2, Circle, Loader2, Minus, Plus, Trash2 } from "lucide-react";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { ActionForm } from "../_components/action-form";
import { suggestRecipients, type RecipientSuggestion } from "../mail/actions";
import { addContactGuestAction, addGuestAction, checkInGuestAction, removeGuestAction, setGuestTicketsAction } from "./guest-actions";

export interface GuestRow {
  id: string;
  contactId: string | null;
  name: string;
  email: string | null;
  tickets: number;
  kindLabel: string;
  note: string | null;
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
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[17px] leading-snug text-fg md:text-sm">
                {g.contactId ? (
                  <Link href={`/contacts/${g.contactId}`} className="hover:underline">
                    {g.name}
                  </Link>
                ) : (
                  g.name
                )}
              </span>
              <span className="block truncate text-[13px] text-subtle md:text-xs">
                {g.kindLabel}
                {g.note ? ` · ${g.note}` : g.email ? ` · ${g.email}` : ""}
              </span>
            </span>
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
 * "Add a guest": search first (contacts, then people you have emailed). A
 * contact goes on the list with one tap, linked to their card; anyone else
 * opens the form with their name and address filled in.
 */
export function AddGuestRow({ eventId, kinds }: { eventId: string; kinds: { value: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RecipientSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [tickets, setTickets] = useState(2);
  const [manual, setManual] = useState<{ name: string; email: string } | null>(null);
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
    if (!r.contactId) {
      setManual({ name: r.name ?? "", email: r.email });
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
        Add a guest
      </button>
      {open ? (
        <Sheet open onClose={close} title="Add a guest" primary={manual ? { label: "Add", form: formId } : undefined}>
          {manual ? (
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
              <div className="flex items-center justify-between gap-3 text-[15px] md:text-sm">
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
                          <span className="shrink-0 rounded-full bg-brand px-3 py-1 text-[13px] font-medium text-white md:text-xs">Add · {tickets}</span>
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
                      Add “{query.trim()}” as a new guest
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
