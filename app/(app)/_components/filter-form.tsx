"use client";

import { useRouter } from "next/navigation";
import type { ComponentProps, FormEvent } from "react";

/**
 * A GET form that works without JavaScript and, with it, navigates client-side
 * with empty fields dropped from the URL. Selects submit on change.
 */
export function FilterForm({
  action,
  scroll = true,
  children,
  ...props
}: Omit<ComponentProps<"form">, "action" | "method" | "onSubmit" | "onChange"> & {
  action: string;
  /** Scroll to the top after navigating (default true). */
  scroll?: boolean;
}) {
  const router = useRouter();

  function navigate(form: HTMLFormElement) {
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(form)) {
      if (typeof value === "string" && value.trim()) params.set(key, value.trim());
    }
    const qs = params.toString();
    router.push(qs ? `${action}?${qs}` : action, { scroll });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate(event.currentTarget);
  }

  function onChange(event: FormEvent<HTMLFormElement>) {
    if (event.target instanceof HTMLSelectElement) navigate(event.currentTarget);
  }

  return (
    <form action={action} method="get" onSubmit={onSubmit} onChange={onChange} {...props}>
      {children}
    </form>
  );
}
