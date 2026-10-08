"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { normalizePrefix } from "@/lib/booking/phone";
import type { SendAccount } from "@/lib/booking/types";
import { cn } from "@/lib/utils";
import { updateSheetSettingsAction } from "../../template-actions";

const CURRENCIES = [
  { value: "EUR", label: "EUR €" },
  { value: "USD", label: "USD $" },
  { value: "GBP", label: "GBP £" },
];

const PREFIXES = [
  { value: "+34", label: "Spain" },
  { value: "+1", label: "US / Canada" },
  { value: "+44", label: "UK" },
  { value: "+33", label: "France" },
  { value: "+351", label: "Portugal" },
  { value: "+49", label: "Germany" },
];

export interface SheetSettingsValues {
  id: string;
  name: string;
  currency: string;
  phonePrefix: string | null;
  sendAccountId: string | null;
  description: string | null;
}

function accountLabel(account: SendAccount) {
  const name = account.displayName && account.displayName !== account.email ? `${account.displayName} · ` : "";
  return `${name}${account.email}${account.status === "reauth_required" ? " (needs reconnect)" : ""}`;
}

/** Name, currency, phone prefix, send-from mailbox and description of a booking sheet. */
export function SheetSettingsForm({ sheet, accounts }: { sheet: SheetSettingsValues; accounts: SendAccount[] }) {
  const formId = useId();
  const [values, setValues] = useState({
    name: sheet.name,
    currency: sheet.currency,
    phonePrefix: sheet.phonePrefix ?? "",
    sendAccountId: sheet.sendAccountId ?? "",
    description: sheet.description ?? "",
  });
  const [status, setStatus] = useState<{ tone: "error" | "saved"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (name: keyof typeof values) => (value: string) => {
    setValues((v) => ({ ...v, [name]: value }));
    setStatus(null);
  };
  const currencies = CURRENCIES.some((c) => c.value === values.currency)
    ? CURRENCIES
    : [...CURRENCIES, { value: values.currency, label: values.currency }];
  const missingAccount = Boolean(values.sendAccountId) && !accounts.some((a) => a.id === values.sendAccountId);
  const firstAccount = accounts[0];
  const prefixInvalid = values.phonePrefix.trim() !== "" && !normalizePrefix(values.phonePrefix);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    startTransition(async () => {
      try {
        const result = await updateSheetSettingsAction(sheet.id, {
          ...values,
          phonePrefix: values.phonePrefix.trim() ? (normalizePrefix(values.phonePrefix) ?? values.phonePrefix.trim()) : "",
        });
        if (!result.ok) {
          setStatus({ tone: "error", text: result.error });
          return;
        }
        setValues((v) => ({ ...v, phonePrefix: v.phonePrefix.trim() ? (normalizePrefix(v.phonePrefix) ?? v.phonePrefix) : "" }));
        setStatus({ tone: "saved", text: "Saved." });
      } catch {
        setStatus({ tone: "error", text: "Not saved. Check your connection and try again." });
      }
    });
  }

  return (
    <section aria-labelledby={`${formId}-title`} className="flex flex-col">
      <h2 id={`${formId}-title`} className="mb-1.5 px-4 text-[13px] uppercase tracking-wide text-subtle md:mb-2 md:px-0 md:text-xs md:font-medium">
        Sheet settings
      </h2>
      <form
        onSubmit={submit}
        aria-busy={pending}
        className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 md:gap-3 md:rounded-lg"
      >
        <Field label="Name" htmlFor={`${formId}-name`}>
          <Input id={`${formId}-name`} value={values.name} required maxLength={120} onChange={(e) => set("name")(e.target.value)} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Currency" htmlFor={`${formId}-currency`}>
            <Select id={`${formId}-currency`} value={values.currency} onChange={(e) => set("currency")(e.target.value)}>
              {currencies.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Phone prefix" htmlFor={`${formId}-prefix`}>
            <Input
              id={`${formId}-prefix`}
              value={values.phonePrefix}
              inputMode="tel"
              autoComplete="off"
              placeholder="+34"
              maxLength={8}
              list={`${formId}-prefixes`}
              aria-invalid={prefixInvalid || undefined}
              aria-describedby={`${formId}-prefix-hint`}
              className={cn(prefixInvalid && "border-danger")}
              onChange={(e) => set("phonePrefix")(e.target.value)}
            />
            <datalist id={`${formId}-prefixes`}>
              {PREFIXES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </datalist>
          </Field>
        </div>
        <p id={`${formId}-prefix-hint`} className={cn("-mt-2 text-xs md:-mt-1.5", prefixInvalid ? "text-danger" : "text-subtle")}>
          {prefixInvalid
            ? "Use a country code like +34 or +1."
            : "Added to numbers typed without a country code: +34 for Spain (985 123 456 → +34 985 123 456), +1 for the US. Empty: numbers are kept as typed."}
        </p>

        <Field
          label="Prepare emails from"
          htmlFor={`${formId}-account`}
          hint={
            accounts.length === 0
              ? "Connect a Gmail account in Settings to prepare emails."
              : "Prepared emails become Gmail drafts in this mailbox and wait in Approvals until you send them."
          }
        >
          <Select id={`${formId}-account`} value={values.sendAccountId} onChange={(e) => set("sendAccountId")(e.target.value)}>
            <option value="">{firstAccount ? `First connected account (${firstAccount.email})` : "First connected account"}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {accountLabel(a)}
              </option>
            ))}
            {missingAccount ? <option value={values.sendAccountId}>A disconnected account: pick another</option> : null}
          </Select>
        </Field>

        <Field label="Description" htmlFor={`${formId}-description`}>
          <Textarea
            id={`${formId}-description`}
            rows={3}
            maxLength={2000}
            value={values.description}
            placeholder="What this campaign is: project, season, territory"
            onChange={(e) => set("description")(e.target.value)}
          />
        </Field>

        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <Button type="submit" variant="primary" disabled={pending || prefixInvalid || !values.name.trim()} className="w-full md:w-auto">
            {pending ? "Saving…" : "Save settings"}
          </Button>
          {status ? (
            <p role={status.tone === "error" ? "alert" : "status"} className={cn("text-sm", status.tone === "error" ? "text-danger" : "text-muted")}>
              {status.text}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}
