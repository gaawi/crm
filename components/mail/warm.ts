"use client";

/**
 * Ask the server to start loading a conversation from Gmail before it is
 * opened (pointer resting on it, finger down, keyboard cursor). At most once
 * a minute per conversation.
 */
const warmed = new Map<string, number>();
const WARM_EVERY_MS = 60_000;

export function warmThread(accountId: string, threadId: string): void {
  const key = `${accountId}:${threadId}`;
  const now = Date.now();
  if (now - (warmed.get(key) ?? 0) < WARM_EVERY_MS) return;
  warmed.set(key, now);
  void fetch("/api/mail/warm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountId, threadId }),
    keepalive: true,
  }).catch(() => warmed.delete(key));
}

/** Pointer handlers for a row: warm after the pointer rests 120 ms (not while sweeping past). */
export function warmOnHover(accountId: string, threadId: string) {
  let timer: number | null = null;
  const clear = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };
  return {
    onPointerEnter: (event: React.PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      clear();
      timer = window.setTimeout(() => warmThread(accountId, threadId), 120);
    },
    onPointerLeave: clear,
    onTouchStart: () => warmThread(accountId, threadId),
  };
}
