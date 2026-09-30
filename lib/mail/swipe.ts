/**
 * Swipe gestures of the phone thread rows (pure; the row component feeds
 * pointer deltas in). Left swipe reveals Trash + Archive, a long left swipe
 * archives, a right swipe toggles read/unread — like iPhone Mail.
 */

export const SWIPE = {
  /** Width of one revealed action button. */
  actionWidth: 78,
  /** Movement before a direction is decided. */
  slop: 8,
  /** Left drag beyond this snaps the actions open. */
  revealAt: 52,
  /** Left drag beyond this fraction of the row width archives on release. */
  fullRatio: 0.55,
  /** Right drag beyond this toggles read/unread on release. */
  toggleAt: 72,
  /** Right drag is capped (it never reveals more than one action). */
  maxRight: 120,
} as const;

export type SwipeLock = "horizontal" | "vertical" | null;

/** Decide once whether the gesture scrolls the list or swipes the row. */
export function swipeLock(dx: number, dy: number): SwipeLock {
  if (Math.abs(dx) < SWIPE.slop && Math.abs(dy) < SWIPE.slop) return null;
  return Math.abs(dx) > Math.abs(dy) * 1.2 ? "horizontal" : "vertical";
}

/** Offset shown while dragging, with rubber-band resistance past the limits. */
export function swipeOffset(dx: number, width: number): number {
  if (dx > 0) {
    if (dx <= SWIPE.maxRight) return dx;
    return SWIPE.maxRight + (dx - SWIPE.maxRight) * 0.25;
  }
  const limit = -width;
  return Math.max(dx, limit);
}

export type SwipeOutcome = "archive" | "open" | "toggle-read" | "close";

/**
 * What happens on release. `dx` is the total offset (including the revealed
 * width when the row started open); `velocity` is px/ms (negative = left).
 */
export function swipeRelease(dx: number, width: number, velocity = 0): SwipeOutcome {
  if (dx >= SWIPE.toggleAt) return "toggle-read";
  if (dx < 0) {
    if (-dx >= width * SWIPE.fullRatio) return "archive";
    if (-dx >= SWIPE.revealAt || velocity < -0.5) return "open";
  }
  return "close";
}

/** Width of the revealed actions (Trash + Archive). */
export const REVEALED_WIDTH = SWIPE.actionWidth * 2;
