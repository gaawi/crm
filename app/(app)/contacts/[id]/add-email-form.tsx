"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useRef, type FormEvent } from "react";
import { Input } from "@/components/ui/field";
import { buttonClass } from "@/components/ui/button";
import { ActionForm, FormSubmit } from "../../_components/action-form";
import type { ActionResult } from "../../_components/action-form";
import type { AddEmailState } from "./actions";

/**
 * "Add address" row. When the address already belongs to someone else, offers
 * to merge that contact into this one (which brings the address along).
 */
export function AddEmailForm({
  contactName,
  action,
  mergeAction,
}: {
  contactName: string;
  action: (state: AddEmailState, formData: FormData) => Promise<AddEmailState>;
  /** Bound per owner id on the server: (ownerId) → merge action. */
  mergeAction: (ownerId: string, state: ActionResult) => Promise<ActionResult>;
}) {
  const [state, dispatch, pending] = useActionState(action, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.added) formRef.current?.reset();
  }, [state.added]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <form ref={formRef} onSubmit={onSubmit} className="flex items-center gap-2" aria-busy={pending}>
        <Input
          name="email"
          type="email"
          inputMode="email"
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          required
          placeholder="Add an address"
          aria-label="Add an email address"
          className="min-w-0 flex-1"
        />
        <button type="submit" disabled={pending} className={buttonClass("secondary", "md", "shrink-0")}>
          {pending ? "Adding…" : "Add"}
        </button>
      </form>
      {state.taken ? (
        <div className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3 text-sm text-fg">
          <p>
            {state.taken.email} already belongs to{" "}
            <Link href={`/contacts/${state.taken.contactId}`} className="font-medium underline underline-offset-2">
              {state.taken.displayName}
            </Link>
            . If it is the same person, merge {state.taken.displayName} into {contactName}: their addresses, email history,
            projects and deals move here.
          </p>
          <ActionForm action={mergeAction.bind(null, state.taken.contactId)} className="flex flex-col gap-2" messageClassName="text-xs">
            <FormSubmit variant="primary" size="sm" pendingLabel="Merging…" className="w-full md:w-fit">
              Merge that contact into this one
            </FormSubmit>
          </ActionForm>
        </div>
      ) : state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : state.message ? (
        <p role="status" className="text-sm text-muted">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
