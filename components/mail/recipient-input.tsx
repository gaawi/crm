"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { suggestRecipients, type RecipientSuggestion } from "@/app/(app)/mail/actions";
import { formatAddress, parseRecipientInput } from "@/lib/mail/compose";
import type { Address } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * To / Cc / Bcc field: addresses as chips, contact autocomplete (debounced
 * suggestRecipients), paste of whole lists, Backspace removes the last chip.
 * Text that is not a complete address stays in the input (`pending`), and the
 * composer commits it on Send.
 */
export function RecipientInput({
  label,
  value,
  onChange,
  pending,
  onPendingChange,
  trailing,
  autoFocus,
}: {
  label: string;
  value: Address[];
  onChange: (next: Address[]) => void;
  pending: string;
  onPendingChange: (text: string) => void;
  trailing?: ReactNode;
  autoFocus?: boolean;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [suggestions, setSuggestions] = useState<RecipientSuggestion[]>([]);
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  const request = useRef(0);

  useEffect(() => {
    const q = pending.trim();
    const current = ++request.current;
    if (q.length < 1 || !focused) {
      const clear = window.setTimeout(() => setSuggestions([]), 0);
      return () => window.clearTimeout(clear);
    }
    const timer = window.setTimeout(async () => {
      try {
        const found = await suggestRecipients(q);
        if (current !== request.current) return;
        const taken = new Set(value.map((a) => a.email));
        setSuggestions(found.filter((s) => !taken.has(s.email)));
        setActive(0);
      } catch {
        if (current === request.current) setSuggestions([]);
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [pending, focused, value]);

  function add(addresses: Address[]) {
    const seen = new Set(value.map((a) => a.email));
    const fresh = addresses.filter((a) => !seen.has(a.email) && seen.add(a.email));
    if (fresh.length) onChange([...value, ...fresh]);
  }

  function commit(text: string): boolean {
    const { addresses, rest } = parseRecipientInput(text);
    add(addresses);
    onPendingChange(rest);
    setSuggestions([]);
    return addresses.length > 0;
  }

  function pick(s: RecipientSuggestion) {
    add([{ email: s.email, name: s.name }]);
    onPendingChange("");
    setSuggestions([]);
    inputRef.current?.focus();
  }

  const open = focused && suggestions.length > 0;

  return (
    <div className="relative flex min-h-12 items-start gap-2 border-b border-border px-4 py-1.5 md:min-h-10 md:px-3 md:py-1">
      <label htmlFor={id} className="mt-2 shrink-0 text-[15px] text-subtle md:mt-1.5 md:text-sm">
        {label}
      </label>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 py-0.5">
        {value.map((a) => (
          <span
            key={a.email}
            title={formatAddress(a)}
            className="inline-flex h-8 max-w-full items-center gap-1 rounded-full bg-surface-2 pl-3 pr-1 text-[15px] text-fg md:h-6 md:pl-2 md:text-[13px]"
          >
            <span className="truncate">{a.name || a.email}</span>
            <button
              type="button"
              aria-label={`Remove ${a.email}`}
              onClick={() => onChange(value.filter((x) => x.email !== a.email))}
              className="-my-1 inline-flex size-9 shrink-0 items-center justify-center rounded-full text-subtle hover:bg-border hover:text-fg md:my-0 md:size-5"
            >
              <X className="size-3.5 md:size-3" strokeWidth={2} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          data-bare
          value={pending}
          autoFocus={autoFocus}
          onChange={(e) => {
            const text = e.target.value;
            if (/[,;\n]/.test(text)) commit(text);
            else onPendingChange(text);
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (/[,;\n]/.test(text) || parseRecipientInput(text).addresses.length) {
              e.preventDefault();
              commit(`${pending}${text}`);
            }
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            if (pending.trim()) commit(pending);
          }}
          onKeyDown={(e) => {
            if (open && e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => (i + 1) % suggestions.length);
            } else if (open && e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
            } else if ((e.key === "Enter" || e.key === "Tab") && !e.metaKey && !e.ctrlKey) {
              if (open) {
                e.preventDefault();
                pick(suggestions[active]);
              } else if (pending.trim() && commit(pending)) {
                e.preventDefault();
              }
            } else if (e.key === "Backspace" && !pending && value.length) {
              onChange(value.slice(0, -1));
            } else if (e.key === "Escape" && open) {
              e.stopPropagation();
              setSuggestions([]);
            }
          }}
          type="text"
          inputMode="email"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          className="h-9 min-w-[8rem] flex-1 bg-transparent text-base text-fg outline-none placeholder:text-subtle md:h-7 md:text-sm"
        />
      </div>
      {trailing}
      {open ? (
        <ul
          id={`${id}-list`}
          role="listbox"
          className="absolute inset-x-2 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-xl md:left-12 md:right-auto md:w-96 md:rounded-lg"
        >
          {suggestions.map((s, i) => (
            <li key={s.email} role="option" aria-selected={i === active}>
              <button
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex w-full flex-col items-start rounded-lg px-3 py-2 text-left md:rounded-md md:py-1.5",
                  i === active ? "bg-surface-2" : "",
                )}
              >
                <span className="w-full truncate text-[15px] text-fg md:text-sm">{s.name ?? s.email}</span>
                <span className="w-full truncate text-[13px] text-muted md:text-xs">
                  {s.name ? s.email : null}
                  {s.organization ? <> · {s.organization}</> : null}
                  {s.contactId ? null : <span className="text-subtle">{s.name ? " · " : ""}not a contact</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
