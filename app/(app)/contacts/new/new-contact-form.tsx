"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Check } from "lucide-react";
import { ProjectDot } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/layout";
import { SubmitButton } from "@/components/ui/submit-button";
import { CONTACT_STATUSES } from "@/lib/constants";
import type { ProjectRef } from "@/lib/types";
import { FormActions } from "../../_components/ui";
import { createContactAction, type NewContactState } from "./actions";

export function NewContactForm({
  projects,
  organizations,
  defaultOrganization = "",
  defaultEmail = "",
  defaultName = "",
}: {
  projects: ProjectRef[];
  organizations: string[];
  /** Prefill from ?org=<name>. */
  defaultOrganization?: string;
  /** Prefill from ?email=<address>. */
  defaultEmail?: string;
  /** Prefill from the mail client's "Add as contact". */
  defaultName?: string;
}) {
  const [state, formAction] = useActionState<NewContactState, FormData>(createContactAction, {});
  const v = state.values;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.error ? (
        <Notice tone="error">
          {state.taken ? (
            <>
              {state.taken.email} already belongs to{" "}
              <Link href={`/contacts/${state.taken.contactId}`} className="font-medium underline underline-offset-2">
                {state.taken.displayName}
              </Link>
              . Open that contact to add details there, or remove the address here.
            </>
          ) : (
            state.error
          )}
        </Notice>
      ) : null}

      <Field label="Name" htmlFor="name">
        <Input id="name" name="name" defaultValue={v?.name ?? defaultName} autoComplete="off" autoCapitalize="words" autoFocus />
      </Field>

      <Field
        label="Email addresses"
        htmlFor="emails"
        hint="One per line or comma separated. The first one is the primary address."
      >
        <Textarea
          id="emails"
          name="emails"
          rows={2}
          defaultValue={v?.emails ?? defaultEmail}
          placeholder="name@example.com"
          inputMode="email"
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={state.taken ? true : undefined}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Organization" htmlFor="organization" hint="Pick an existing one or type a new name.">
          <Input
            id="organization"
            name="organization"
            list="organization-options"
            defaultValue={v?.organization ?? defaultOrganization}
            autoComplete="off"
          />
          <datalist id="organization-options">
            {organizations.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </Field>
        <Field label="Role" htmlFor="role">
          <Input id="role" name="role" defaultValue={v?.role} autoComplete="off" />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Status" htmlFor="status">
          <Select id="status" name="status" defaultValue={v?.status ?? "active"}>
            {CONTACT_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tags" htmlFor="tags" hint="Comma separated.">
          <Input id="tags" name="tags" defaultValue={v?.tags} placeholder="funder, press" autoComplete="off" />
        </Field>
      </div>

      {projects.length ? (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-xs font-medium text-muted">Projects</legend>
          <div className="flex flex-wrap gap-1.5">
            {projects.map((p) => (
              <label
                key={p.id}
                className="group inline-flex h-9 cursor-pointer select-none items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-[13px] text-muted md:h-7 md:px-2.5 md:text-xs transition-colors hover:border-border-strong hover:text-fg has-checked:border-border-strong has-checked:bg-surface-2 has-checked:text-fg has-focus-visible:ring-2 has-focus-visible:ring-ring"
              >
                <input
                  type="checkbox"
                  name="projectIds"
                  value={p.id}
                  defaultChecked={v?.projectIds.includes(p.id)}
                  className="sr-only"
                />
                <ProjectDot color={p.color} />
                {p.name}
                <Check className="hidden size-3 group-has-checked:block" strokeWidth={2} aria-hidden />
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-[11rem_1fr]">
        <Field label="Follow-up date" htmlFor="followUpAt">
          <Input id="followUpAt" name="followUpAt" type="date" defaultValue={v?.followUpAt} />
        </Field>
        <Field label="Follow-up note" htmlFor="followUpNote">
          <Input
            id="followUpNote"
            name="followUpNote"
            defaultValue={v?.followUpNote}
            placeholder="What to follow up about"
            autoComplete="off"
          />
        </Field>
      </div>

      <Field label="Notes" htmlFor="notes">
        <Textarea id="notes" name="notes" rows={5} defaultValue={v?.notes} />
      </Field>

      <FormActions className="border-t border-border pt-5">
        <SubmitButton pendingLabel="Creating…">Create contact</SubmitButton>
        <ButtonLink href="/contacts" variant="ghost">
          Cancel
        </ButtonLink>
      </FormActions>
    </form>
  );
}
