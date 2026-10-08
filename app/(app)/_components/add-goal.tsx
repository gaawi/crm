"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { GoalKindOptions, NextActionOptions } from "@/components/goals";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { GOAL_KINDS, goalLabel } from "@/lib/constants";
import type { GoalInput, NextAction, OpportunityKind } from "@/lib/types";
import { addContactGoalAction } from "../contacts/[id]/actions";
import { createGoalAction } from "../pipeline/actions";

/**
 * "Add goal" (contact and organization pages): goal type, an optional title
 * (named "<goal> · <organization or contact>" when left empty), the next
 * step and its date. A dialog on desktop, a full-screen sheet on phones.
 * "More fields" opens the full goal form in the pipeline.
 */
export function AddGoalButton({
  target,
  name,
  moreHref,
  variant = "link",
}: {
  /** Who the goal is with. A contact's goal also gets the contact's organization. */
  target: { contactId: string } | { organizationId: string };
  /** The organization or contact the default title names. */
  name: string;
  /** The full form (/pipeline?new=1&…). */
  moreHref: string;
  /** "link": the small "+ Add" of a group title; "button": a labelled button (empty state). */
  variant?: "link" | "button";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {variant === "link" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-7 items-center gap-1 text-[15px] text-fg/80 active:opacity-60 md:h-auto md:text-xs md:text-muted md:hover:text-fg"
        >
          <Plus className="size-4 md:size-3.5" strokeWidth={1.75} />
          Add goal
        </button>
      ) : (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <Plus className="size-4" strokeWidth={1.75} />
          Add goal
        </Button>
      )}
      {open ? <AddGoalSheet target={target} name={name} moreHref={moreHref} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function AddGoalSheet({
  target,
  name,
  moreHref,
  onClose,
}: {
  target: { contactId: string } | { organizationId: string };
  name: string;
  moreHref: string;
  onClose: () => void;
}) {
  const id = useId();
  const formId = `${id}-form`;
  const [kind, setKind] = useState<OpportunityKind>("booking");
  const [title, setTitle] = useState("");
  const [nextAction, setNextAction] = useState<NextAction | "">("");
  const [followUpAt, setFollowUpAt] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const hint = GOAL_KINDS.find((k) => k.value === kind)?.hint;
  const dirty = Boolean(title.trim() || nextAction || followUpAt || nextStep.trim());

  const requestClose = () => {
    if (pending) return;
    if (dirty && !window.confirm("Discard this goal?")) return;
    onClose();
  };

  function submit() {
    if (pending) return;
    setError(null);
    const input: Omit<GoalInput, "contactId"> = {
      kind,
      title: title.trim() || undefined,
      nextAction: nextAction || null,
      followUpAt: followUpAt || null,
      nextStep: nextStep.trim() || null,
    };
    start(async () => {
      try {
        const result =
          "contactId" in target
            ? await addContactGoalAction(target.contactId, input)
            : await createGoalAction({ ...input, organizationId: target.organizationId });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onClose();
      } catch {
        setError("Not saved. Check your connection and try again.");
      }
    });
  }

  return (
    <Sheet
      open
      onClose={requestClose}
      title="Add goal"
      description={`What you want from ${name}, and what comes next.`}
      primary={{ label: "Add", form: formId, pending }}
      footer={
        <>
          <Button variant="ghost" onClick={requestClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={pending}>
            {pending ? "Adding…" : "Add goal"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex flex-col gap-5 md:gap-4"
        aria-busy={pending}
      >
        <Field label="Goal" htmlFor={`${id}-kind`} hint={hint}>
          <Select id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.currentTarget.value as OpportunityKind)} data-autofocus>
            <GoalKindOptions />
          </Select>
        </Field>
        <Field label="Title (optional)" htmlFor={`${id}-title`}>
          <Input
            id={`${id}-title`}
            value={title}
            maxLength={300}
            autoComplete="off"
            placeholder={`${goalLabel(kind)} · ${name}`}
            onChange={(e) => setTitle(e.currentTarget.value)}
          />
        </Field>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,10rem)] gap-3">
          <Field label="Next step" htmlFor={`${id}-action`}>
            <Select id={`${id}-action`} value={nextAction} onChange={(e) => setNextAction(e.currentTarget.value as NextAction | "")}>
              <option value="">No next step</option>
              <NextActionOptions />
            </Select>
          </Field>
          <Field label="Due" htmlFor={`${id}-due`}>
            <Input id={`${id}-due`} type="date" value={followUpAt} onChange={(e) => setFollowUpAt(e.currentTarget.value)} />
          </Field>
        </div>
        <Field label="Detail (optional)" htmlFor={`${id}-detail`}>
          <Input
            id={`${id}-detail`}
            value={nextStep}
            maxLength={300}
            autoComplete="off"
            placeholder="Ask about the autumn season"
            onChange={(e) => setNextStep(e.currentTarget.value)}
          />
        </Field>
        <p className="text-[13px] text-subtle md:text-xs">
          Value, project and notes:{" "}
          <Link href={moreHref} className="text-fg/80 underline-offset-2 hover:underline">
            open the full form
          </Link>
          .
        </p>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}
