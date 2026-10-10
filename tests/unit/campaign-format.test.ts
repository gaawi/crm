import { describe, expect, it } from "vitest";
import {
  countParts,
  dailyCapBinds,
  isHeldBack,
  paceSentence,
  planSentence,
  roundUpToTick,
  timeZoneCity,
  whenPhrase,
} from "@/lib/campaigns/format";
import { estimateSends } from "@/lib/campaigns/schedule";
import { DEFAULT_CAMPAIGN_SETTINGS, type CampaignCounts } from "@/lib/campaigns/types";

const counts = (partial: Partial<CampaignCounts>): CampaignCounts => {
  const c = { proposed: 0, queued: 0, revising: 0, sending: 0, sent: 0, discarded: 0, failed: 0, postponed: 0, changes_requested: 0, ...partial };
  return { ...c, total: Object.values(c).reduce((a, b) => a + b, 0) };
};

describe("campaign wording", () => {
  it("names the zone city and rounds estimates up to the 5-minute cron tick", () => {
    expect(timeZoneCity("Europe/Madrid")).toBe("Madrid");
    expect(timeZoneCity("America/New_York")).toBe("New York");
    expect(roundUpToTick(new Date("2026-10-02T14:56:10Z")).toISOString()).toBe("2026-10-02T15:00:00.000Z");
    expect(roundUpToTick(new Date("2026-10-02T15:00:00Z")).toISOString()).toBe("2026-10-02T15:00:00.000Z");
  });

  it("says when, relative to today in the campaign's timezone", () => {
    const now = new Date("2026-10-02T14:56:00Z"); // Fri 16:56 in Madrid
    expect(whenPhrase(new Date("2026-10-02T15:00:00Z"), "Europe/Madrid", now)).toBe("around 17:00");
    expect(whenPhrase(new Date("2026-10-03T07:00:00Z"), "Europe/Madrid", now)).toBe("tomorrow around 9:00");
    expect(whenPhrase(new Date("2026-10-05T07:00:00Z"), "Europe/Madrid", now)).toBe("Mon 5 Oct around 9:00");
  });

  it("describes the pace, with the daily maximum only when it limits the day", () => {
    expect(paceSentence(DEFAULT_CAMPAIGN_SETTINGS)).toBe("about 10 an hour, at most 40 a day, 9:00–19:00 Monday–Friday (Madrid)");
    const loose = { ...DEFAULT_CAMPAIGN_SETTINGS, dailyCap: 200, weekdaysOnly: false, timezone: "America/New_York" };
    expect(dailyCapBinds(loose)).toBe(false);
    expect(paceSentence(loose)).toBe("about 10 an hour, 9:00–19:00 every day (New York)");
  });

  it("writes the plan for 87 emails approved on a Friday afternoon", () => {
    const now = new Date("2026-10-02T14:56:00Z");
    const settings = DEFAULT_CAMPAIGN_SETTINGS;
    const { next, finish } = estimateSends(settings, { count: 87, now });
    const plan = planSentence({ count: 87, accountEmail: "guillermolaporta@gmail.com", settings, next, finish, now, ownerTimezone: "Europe/Madrid" });
    expect(plan).toBe(
      "87 emails from guillermolaporta@gmail.com, about 10 an hour, at most 40 a day, 9:00–19:00 Monday–Friday (Madrid). First one around 17:00, last one around Tue 6 Oct.",
    );
    const elsewhere = planSentence({ count: 87, accountEmail: "a@b.co", settings, next, finish, now, ownerTimezone: "America/New_York" });
    expect(elsewhere.endsWith("last one around Tue 6 Oct (Madrid time).")).toBe(true);
    expect(planSentence({ count: 1, accountEmail: "a@b.co", settings, next, finish: next, now })).toBe(
      "1 email from a@b.co, about 10 an hour, at most 40 a day, 9:00–19:00 Monday–Friday (Madrid). It goes out around 17:00.",
    );
    expect(planSentence({ count: 0, accountEmail: "a@b.co", settings, next: null, finish: null, now })).toBe("Nothing left to send.");
  });

  it("counts held-back emails apart from the ones to approve", () => {
    expect(isHeldBack({ status: "proposed", error: "Held back: Ana wrote to you on Oct 3 — check before sending." })).toBe(true);
    expect(isHeldBack({ status: "proposed", error: "Not saved to Gmail yet: offline" })).toBe(false);
    expect(isHeldBack({ status: "failed", error: "Held back: …" })).toBe(false);
    const parts = countParts(counts({ proposed: 5, queued: 70, sent: 10, failed: 1, discarded: 2 }), 2);
    expect(parts.map((p) => `${p.count} ${p.label}`)).toEqual(["3 to approve", "70 queued", "10 sent", "2 held back", "1 failed"]);
    expect(countParts(counts({ discarded: 2 }), 0, { discarded: true }).map((p) => p.key)).toEqual(["discarded"]);
  });
});
