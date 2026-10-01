"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Field, Input, Textarea } from "@/components/ui/field";
import { ActionForm, FormSubmit } from "../../_components/action-form";
import { FormActions } from "../../_components/ui";
import { addRowAction } from "../actions";

/**
 * "Add a venue or presenter": stays open after each add (with empty fields and
 * the cursor back in the first one) so a list can be typed in one go.
 */
export function AddRowPanel({ projectId, currency, initiallyOpen }: { projectId: string; currency: string; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const ref = useRef<HTMLDivElement>(null);
  const reset = () => {
    const form = ref.current?.querySelector("form");
    form?.reset();
    form?.querySelector<HTMLInputElement>('input[name="organization"]')?.focus();
  };
  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="group mb-5 rounded-xl border border-border bg-surface md:rounded-lg"
    >
      <summary className="flex h-12 cursor-pointer list-none items-center gap-2 px-4 text-[15px] font-medium text-fg md:h-10 md:text-sm [&::-webkit-details-marker]:hidden">
        <Plus className="size-4" /> Add a venue or presenter
      </summary>
      <div ref={ref}>
        <ActionForm action={addRowAction.bind(null, projectId)} onDone={reset} className="flex flex-col gap-3 border-t border-border p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Venue / presenter">
              <Input name="organization" required placeholder="Teatro Campoamor" />
            </Field>
            <Field label="City">
              <Input name="city" placeholder="Oviedo" />
            </Field>
            <Field label="Website">
              <Input name="website" type="url" placeholder="https://" />
            </Field>
            <Field label="Contact name">
              <Input name="contactName" placeholder="Name Surname" />
            </Field>
            <Field label="Role">
              <Input name="role" placeholder="Artistic director" />
            </Field>
            <Field label="Email">
              <Input name="email" type="email" inputMode="email" autoComplete="off" placeholder="name@venue.org" />
            </Field>
            <Field label="Dates">
              <Input name="eventDates" placeholder="Spring 2027" />
            </Field>
            <Field label={`Fee (${currency})`}>
              <Input name="fee" inputMode="decimal" placeholder="5000" />
            </Field>
            <Field label="Follow up on">
              <Input name="followUpAt" type="date" />
            </Field>
          </div>
          <Field label="Next step">
            <Input name="nextStep" placeholder="Send proposal" />
          </Field>
          <Field label="Notes">
            <Textarea name="notes" rows={2} />
          </Field>
          <FormActions>
            <FormSubmit pendingLabel="Adding…">Add to sheet</FormSubmit>
          </FormActions>
        </ActionForm>
      </div>
    </details>
  );
}
