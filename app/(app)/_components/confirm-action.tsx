"use client";

import { useState, type ReactNode } from "react";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { ActionForm, FormSubmit, type ActionResult } from "./action-form";

/**
 * A button that opens an inline confirm step before running a destructive
 * server action. With `requireCheck`, the confirm button stays disabled until
 * the checkbox is ticked (the action should re-check `confirm=on`).
 */
export function ConfirmAction({
  action,
  label,
  confirmLabel,
  pendingLabel,
  children,
  requireCheck,
  triggerVariant = "ghost",
  className,
}: {
  action: (state: ActionResult, formData: FormData) => Promise<ActionResult>;
  /** Trigger button text. */
  label: ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  /** Explanation shown in the confirm step. */
  children: ReactNode;
  /** Label of a checkbox that must be ticked (sent as confirm=on). */
  requireCheck?: ReactNode;
  triggerVariant?: ButtonVariant;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);

  if (!open) {
    return (
      <Button
        variant={triggerVariant}
        size="sm"
        className={cn(triggerVariant === "ghost" && "text-danger hover:text-danger", className)}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
    );
  }

  return (
    <ActionForm
      action={action}
      className={cn("flex w-full flex-col gap-3 rounded-md border border-border bg-bg p-3", className)}
      messageClassName="text-xs"
    >
      <div className="text-sm text-fg">{children}</div>
      {requireCheck ? (
        <label className="flex items-start gap-2 text-sm text-muted">
          <Checkbox name="confirm" required checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5" />
          <span>{requireCheck}</span>
        </label>
      ) : null}
      <div className="flex items-center gap-2">
        <FormSubmit variant="danger" size="sm" pendingLabel={pendingLabel} disabled={Boolean(requireCheck) && !checked}>
          {confirmLabel}
        </FormSubmit>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(false);
            setChecked(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </ActionForm>
  );
}
