import "server-only";
import type { FollowUps } from "@/lib/types";

/**
 * The follow-up lists (see docs/ARCHITECTURE.md → Follow-ups).
 * `today` is 'YYYY-MM-DD' in the owner's timezone. Archived contacts never appear.
 */
export async function getFollowUps(options: {
  today: string;
  /** Default AWAITING_REPLY_DAYS. */
  awaitingDays?: number;
  /** Default REPLY_LOOKBACK_DAYS. */
  lookbackDays?: number;
  /** Per list, default 50. */
  limit?: number;
  /** Include follow-ups due within this many days after today (default 0). */
  horizonDays?: number;
}): Promise<FollowUps> {
  void options;
  throw new Error("TODO");
}

/** Contacts with a follow-up date in (today, today + days], soonest first. */
export async function getUpcomingFollowUps(options: { today: string; days: number; limit?: number }): Promise<FollowUps["due"]> {
  void options;
  throw new Error("TODO");
}
