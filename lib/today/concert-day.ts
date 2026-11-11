import { toISODate } from "@/lib/dates";

/**
 * The concerts happening today, each judged in its own time zone (a show at
 * 8pm in New York is "today" there all day, until midnight local time).
 */
export function concertsToday<T extends { startsAt: Date; timeZone: string }>(events: T[], now: Date = new Date()): T[] {
  return events.filter((e) => toISODate(e.startsAt, e.timeZone) === toISODate(now, e.timeZone));
}
