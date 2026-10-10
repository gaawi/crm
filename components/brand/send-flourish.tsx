"use client";

import { useEffect, useState } from "react";
import { VelaMark } from "@/components/brand/vela-logo";

/**
 * "Sent" micro-animation: after an email is approved & sent (or a campaign is
 * started) the Vela sail glides up and to the right from the button and fades
 * out with a soft trail (~900ms). Purely visual and fired only after success:
 * it never delays or blocks anything, and with prefers-reduced-motion it is
 * skipped (the toast / message says what happened).
 *
 *   const origin = flourishOrigin(event.currentTarget); // at click time
 *   … after the action succeeded: celebrateSend(origin);
 *
 * <SendFlourishHost /> (mounted once in the app layout) draws it.
 */

const EVENT = "vela:sent";
const DURATION_MS = 950;

export interface FlourishOrigin {
  x: number;
  y: number;
}

/** The center of the element (the button pressed), taken at click time: the card may be gone after the refresh. */
export function flourishOrigin(element: Element | null | undefined): FlourishOrigin | null {
  if (!element) return null;
  const r = element.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export function celebrateSend(origin?: FlourishOrigin | null) {
  if (typeof window === "undefined") return;
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  } catch {
    // Old browsers: animate.
  }
  window.dispatchEvent(new CustomEvent<FlourishOrigin | null>(EVENT, { detail: origin ?? null }));
}

interface Flight {
  id: number;
  x: number;
  y: number;
}

export function SendFlourishHost() {
  const [flights, setFlights] = useState<Flight[]>([]);

  useEffect(() => {
    let seq = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const onSent = (event: Event) => {
      const detail = (event as CustomEvent<FlourishOrigin | null>).detail;
      // Default: bottom center, above the phone tab bar.
      const x = detail?.x ?? window.innerWidth / 2;
      const y = detail?.y ?? window.innerHeight - 120;
      const id = ++seq;
      setFlights((list) => [...list.slice(-2), { id, x, y }]);
      const timer = setTimeout(() => {
        timers.delete(timer);
        setFlights((list) => list.filter((f) => f.id !== id));
      }, DURATION_MS);
      timers.add(timer);
    };
    window.addEventListener(EVENT, onSent);
    return () => {
      window.removeEventListener(EVENT, onSent);
      for (const t of timers) clearTimeout(t);
    };
  }, []);

  if (!flights.length) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[80] overflow-hidden" data-testid="send-flourish">
      {flights.map((f) => (
        <div key={f.id} className="absolute" style={{ left: f.x, top: f.y }}>
          <span className="vela-trail absolute left-0 top-0 block h-[3px] w-24 rounded-full bg-gradient-to-r from-transparent via-brand/40 to-brand/70" />
          <span className="vela-glide absolute -left-4 -top-4 block drop-shadow-sm">
            <VelaMark size={32} />
          </span>
        </div>
      ))}
    </div>
  );
}
