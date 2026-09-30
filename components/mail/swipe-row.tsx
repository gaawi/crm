"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { REVEALED_WIDTH, SWIPE, swipeLock, swipeOffset, swipeRelease } from "@/lib/mail/swipe";
import { cn } from "@/lib/utils";

export interface SwipeAction {
  label: string;
  icon: LucideIcon;
  /** Background color class. */
  tone: string;
  run: () => void;
}

/**
 * iPhone Mail row gestures with pointer events (no library): swipe left to
 * reveal [secondary, primary] (a long swipe runs primary and the row slides
 * out), swipe right to run `leading` (read/unread). Vertical scrolling stays
 * native thanks to touch-action: pan-y.
 */
export function SwipeRow({
  children,
  primary,
  secondary,
  leading,
  open,
  onOpenChange,
  className,
}: {
  children: ReactNode;
  primary: SwipeAction;
  secondary?: SwipeAction;
  leading?: SwipeAction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState<"slide" | "collapse" | null>(null);
  const gesture = useRef<{ x: number; y: number; t: number; base: number; lock: "horizontal" | "vertical" | null; id: number } | null>(null);
  const suppressClick = useRef(false);
  const revealed = secondary ? REVEALED_WIDTH : SWIPE.actionWidth;

  // Another row opened (or the list closed us): snap shut.
  useEffect(() => {
    if (!open && !dragging && !leaving) {
      const frame = requestAnimationFrame(() => setOffset((o) => (o < 0 ? 0 : o)));
      return () => cancelAnimationFrame(frame);
    }
  }, [open, dragging, leaving]);

  const width = () => rootRef.current?.offsetWidth ?? 390;

  function runPrimary() {
    setLeaving("slide");
    setOffset(-width());
    window.setTimeout(() => setLeaving("collapse"), 180);
    window.setTimeout(() => primary.run(), 360);
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (leaving) return;
    gesture.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, base: open ? -revealed : 0, lock: null, id: e.pointerId };
    if (!open) onOpenChange(false);
  }

  function onPointerMove(e: React.PointerEvent) {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.lock) {
      g.lock = swipeLock(dx, dy);
      if (g.lock === "horizontal") {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setDragging(true);
      }
    }
    if (g.lock !== "horizontal") return;
    let next = swipeOffset(g.base + dx, width());
    if (!leading && next > 0) next = 0;
    setOffset(next);
  }

  function onPointerEnd(e: React.PointerEvent) {
    const g = gesture.current;
    gesture.current = null;
    if (!g || g.lock !== "horizontal") {
      if (g && open) {
        // A tap on an open row closes it instead of opening the thread.
        suppressClick.current = true;
        onOpenChange(false);
        setOffset(0);
      }
      return;
    }
    suppressClick.current = true;
    setDragging(false);
    const elapsed = Math.max(1, e.timeStamp - g.t);
    const velocity = (e.clientX - g.x) / elapsed;
    const outcome = swipeRelease(offset, width(), velocity);
    if (outcome === "archive") {
      onOpenChange(false);
      runPrimary();
    } else if (outcome === "open") {
      setOffset(-revealed);
      onOpenChange(true);
    } else if (outcome === "toggle-read" && leading) {
      setOffset(0);
      onOpenChange(false);
      leading.run();
    } else {
      setOffset(0);
      onOpenChange(false);
    }
  }

  const full = -offset >= width() * SWIPE.fullRatio;
  const trailingWidth = Math.max(0, -offset);

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative overflow-hidden transition-[max-height,opacity] duration-200 ease-out",
        leaving === "collapse" ? "max-h-0 opacity-0" : "max-h-60",
        className,
      )}
    >
      {/* Leading action (swipe right) */}
      {leading && offset > 0 ? (
        <div className={cn("absolute inset-y-0 left-0 flex items-center justify-start text-white", leading.tone)} style={{ width: offset }}>
          <span className={cn("flex w-[78px] flex-col items-center gap-1 text-[13px] font-medium transition-transform", offset >= SWIPE.toggleAt ? "scale-110" : "")}>
            <leading.icon className="size-6" strokeWidth={2} />
            {leading.label}
          </span>
        </div>
      ) : null}

      {/* Trailing actions (swipe left) */}
      {offset < 0 ? (
        <div className="absolute inset-y-0 right-0 flex" style={{ width: trailingWidth }}>
          {secondary && !full ? (
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                setLeaving("collapse");
                window.setTimeout(() => secondary.run(), 200);
              }}
              className={cn("flex h-full flex-1 flex-col items-center justify-center gap-1 overflow-hidden text-[13px] font-medium text-white", secondary.tone)}
            >
              <secondary.icon className="size-6 shrink-0" strokeWidth={2} />
              {secondary.label}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              onOpenChange(false);
              runPrimary();
            }}
            className={cn(
              "flex h-full flex-col items-center justify-center gap-1 overflow-hidden text-[13px] font-medium text-white transition-[flex-grow]",
              full ? "flex-[10]" : "flex-1",
              primary.tone,
            )}
          >
            <primary.icon className="size-6 shrink-0" strokeWidth={2} />
            {primary.label}
          </button>
        </div>
      ) : null}

      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={(e) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        style={{ transform: `translate3d(${offset}px,0,0)` }}
        className={cn("relative touch-pan-y bg-surface", !dragging && "transition-transform duration-200 ease-out")}
      >
        {children}
      </div>
    </div>
  );
}
