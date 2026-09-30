"use client";

import { createContext, startTransition, useActionState, useContext, type ComponentProps, type FormEvent, type ReactNode } from "react";
import { buttonClass, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** What the server actions used with <ActionForm> return. */
export interface ActionResult {
  error?: string;
  message?: string;
}

const PendingContext = createContext(false);

/**
 * <form> wired to a server action with useActionState. Shows the returned
 * `error` / `message` below its children.
 *
 * Submission goes through onSubmit + startTransition instead of the `action`
 * prop so that React does not reset the fields after the action returns: when
 * the server answers with a validation error, what the user typed stays put.
 * Use <FormSubmit> inside for a pending-aware submit button.
 */
export function ActionForm({
  action,
  children,
  className,
  onDone,
  messageClassName,
  id,
}: {
  action: (state: ActionResult, formData: FormData) => Promise<ActionResult>;
  children: ReactNode;
  className?: string;
  /** Called after an action returned without an error (client parents only). */
  onDone?: (result: ActionResult) => void;
  messageClassName?: string;
  /** Lets a submit button outside the form (e.g. a sheet's header) target it with form={id}. */
  id?: string;
}) {
  const [state, dispatch, pending] = useActionState(async (prev: ActionResult, formData: FormData) => {
    const result = (await action(prev, formData)) ?? {};
    if (!result.error) onDone?.(result);
    return result;
  }, {});

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter);
    startTransition(() => dispatch(formData));
  }

  return (
    <form id={id} onSubmit={onSubmit} className={className} aria-busy={pending}>
      <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>
      {state.error ? (
        <p role="alert" className={cn("text-sm text-danger", messageClassName)}>
          {state.error}
        </p>
      ) : state.message ? (
        <p role="status" className={cn("text-sm text-muted", messageClassName)}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

/** Submit button for <ActionForm>: disabled with `pendingLabel` while the action runs. */
export function FormSubmit({
  children,
  pendingLabel,
  variant = "primary",
  size = "md",
  className,
  disabled,
  ...props
}: ComponentProps<"button"> & { pendingLabel?: string; variant?: ButtonVariant; size?: ButtonSize }) {
  const pending = useContext(PendingContext);
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending}
      className={buttonClass(variant, size, className)}
      {...props}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
