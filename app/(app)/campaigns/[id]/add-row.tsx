"use client";

import { useId, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GoalKindOptions, NextActionOptions } from "@/components/goals";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { ActionForm, FormSubmit } from "../../_components/action-form";
import { FormActions } from "../../_components/ui";
import { addRowAction } from "../actions";

/**
 * "Add venue": a form in a panel (a full-screen sheet on phones) that stays
 * open after each add, with empty fields and the cursor back in the first
 * one, so a list can be typed in one go.
 *
 * `variant`: "header" = "+" on phones / "Add venue" on desktop (page header);
 * "button" = a labelled primary button (empty state).
 */
export function AddRowButton({
  projectId,
  currency,
  phonePrefix,
  sections,
  variant = "header",
}: {
  projectId: string;
  currency: string;
  /** "+34": added to numbers typed without a country code. */
  phonePrefix: string | null;
  sections: string[];
  variant?: "header" | "button";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {variant === "header" ? (
        <>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Add contact"
            title="Add contact"
            className="-mr-2 inline-flex size-11 items-center justify-center rounded-full text-fg active:opacity-60 md:hidden"
          >
            <Plus className="size-7" strokeWidth={1.75} />
          </button>
          <span className="hidden md:inline-flex">
            <Button variant="primary" onClick={() => setOpen(true)}>
              <Plus className="size-4" strokeWidth={1.75} />
              Add contact
            </Button>
          </span>
        </>
      ) : (
        <Button variant="primary" onClick={() => setOpen(true)}>
          <Plus className="size-4" strokeWidth={1.75} />
          Add contact
        </Button>
      )}
      {open ? (
        <AddRowSheet projectId={projectId} currency={currency} phonePrefix={phonePrefix} sections={sections} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

function AddRowSheet({
  projectId,
  currency,
  phonePrefix,
  sections,
  onClose,
}: {
  projectId: string;
  currency: string;
  phonePrefix: string | null;
  sections: string[];
  onClose: () => void;
}) {
  const id = useId();
  const formRef = useRef<HTMLDivElement>(null);
  const [added, setAdded] = useState(0);
  const reset = () => {
    const form = formRef.current?.querySelector("form");
    form?.reset();
    form?.querySelector<HTMLInputElement>('input[name="organization"]')?.focus();
    setAdded((n) => n + 1);
  };
  const phoneHint = phonePrefix ? `Without a country code, ${phonePrefix} is added.` : "Include the country code (+34…).";

  return (
    <Sheet
      open
      onClose={onClose}
      variant="panel"
      title="Add contact"
      description={added ? `${added} added. Keep typing, or close when you're done.` : "The organization, its contact person, and where things stand."}
      className="md:w-[40rem]"
    >
      <div ref={formRef}>
        <ActionForm action={addRowAction.bind(null, projectId)} onDone={reset} className="flex flex-col gap-4 md:gap-3">
          <div className="grid gap-4 md:grid-cols-2 md:gap-3">
            <Field label="Organization" htmlFor={`${id}-org`}>
              <Input id={`${id}-org`} name="organization" required data-autofocus placeholder="Teatro Campoamor" />
            </Field>
            <Field label="City" htmlFor={`${id}-city`}>
              <Input id={`${id}-city`} name="city" placeholder="Oviedo" />
            </Field>
            <Field label="Halls / spaces" htmlFor={`${id}-spaces`}>
              <Input id={`${id}-spaces`} name="spaces" placeholder="Sala principal, Sala B" />
            </Field>
            <Field label="Section" htmlFor={`${id}-section`}>
              <Input id={`${id}-section`} name="section" list={`${id}-sections`} autoComplete="off" placeholder="Internacional" />
              <datalist id={`${id}-sections`}>
                {sections.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </Field>
            <Field label="Website" htmlFor={`${id}-web`} className="md:col-span-2">
              <Input id={`${id}-web`} name="website" type="url" inputMode="url" placeholder="https://" />
            </Field>
          </div>

          <fieldset className="grid gap-4 border-t border-border pt-4 md:grid-cols-2 md:gap-3">
            <legend className="sr-only">Contact</legend>
            <Field label="Contact name" htmlFor={`${id}-name`}>
              <Input id={`${id}-name`} name="contactName" autoComplete="off" placeholder="Name Surname" />
            </Field>
            <Field label="Role" htmlFor={`${id}-role`}>
              <Input id={`${id}-role`} name="role" placeholder="Artistic director" />
            </Field>
            <Field label="Email" htmlFor={`${id}-email`} className="md:col-span-2">
              <Input id={`${id}-email`} name="email" type="email" inputMode="email" autoComplete="off" placeholder="name@organization.org" />
            </Field>
            <Field label="Phone" htmlFor={`${id}-phone`} hint={phoneHint}>
              <Input id={`${id}-phone`} name="phone" type="tel" inputMode="tel" autoComplete="off" placeholder="612 345 678" />
            </Field>
            <Field label="WhatsApp" htmlFor={`${id}-wa`} hint="Only if different from the phone.">
              <Input id={`${id}-wa`} name="whatsapp" type="tel" inputMode="tel" autoComplete="off" placeholder="Same as phone" />
            </Field>
          </fieldset>

          <fieldset className="grid gap-4 border-t border-border pt-4 md:grid-cols-3 md:gap-3">
            <legend className="sr-only">Goal and next step</legend>
            <Field label="Goal" htmlFor={`${id}-kind`} hint="What you want from them.">
              <Select id={`${id}-kind`} name="kind" defaultValue="booking">
                <GoalKindOptions />
              </Select>
            </Field>
            <Field label="Next step" htmlFor={`${id}-action`}>
              <Select id={`${id}-action`} name="nextAction" defaultValue="">
                <option value="">No next step</option>
                <NextActionOptions />
              </Select>
            </Field>
            <Field label="Due" htmlFor={`${id}-follow`}>
              <Input id={`${id}-follow`} name="followUpAt" type="date" />
            </Field>
            <Field label="Next step detail" htmlFor={`${id}-next`} className="md:col-span-3">
              <Input id={`${id}-next`} name="nextStep" autoComplete="off" placeholder="Ask for Ana, the season's dates…" />
            </Field>
          </fieldset>

          <fieldset className="grid gap-4 border-t border-border pt-4 md:grid-cols-2 md:gap-3">
            <legend className="sr-only">Dates and fee</legend>
            <Field label="Dates" htmlFor={`${id}-dates`}>
              <Input id={`${id}-dates`} name="eventDates" placeholder="Spring 2027" />
            </Field>
            <Field label={`Fee (${currency})`} htmlFor={`${id}-fee`}>
              <Input id={`${id}-fee`} name="fee" inputMode="decimal" placeholder="5000" />
            </Field>
            <Field label="Notes" htmlFor={`${id}-notes`} className="md:col-span-2">
              <Textarea id={`${id}-notes`} name="notes" rows={2} />
            </Field>
          </fieldset>

          <label className={cn("flex min-h-11 cursor-pointer items-center gap-3 text-[15px] md:min-h-0 md:gap-2 md:text-sm")}>
            <Checkbox name="returning" />
            Returning <span className="text-muted">· worked with us before</span>
          </label>

          <FormActions>
            <FormSubmit pendingLabel="Adding…">Add to campaign</FormSubmit>
            <Button variant="ghost" onClick={onClose}>
              {added ? "Done" : "Cancel"}
            </Button>
          </FormActions>
        </ActionForm>
      </div>
    </Sheet>
  );
}
