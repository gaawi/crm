"use client";

import { useEffect, useRef } from "react";

/**
 * Gmail keyboard shortcuts, desktop only (≥ md) and ignored while typing or
 * while a dialog (the composer) has focus. Keys are matched on `event.key`
 * ("U" with Shift, "#", "/"…).
 */
export function useShortcuts(handlers: Record<string, (event: KeyboardEvent) => void>) {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (!window.matchMedia("(min-width: 768px)").matches) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='dialog']")) return;
      // Enter keeps its meaning on focused links and buttons.
      if (event.key === "Enter" && target?.closest("a, button, summary, [role='button']")) return;
      const handler = ref.current[event.key];
      if (!handler) return;
      event.preventDefault();
      handler(event);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
