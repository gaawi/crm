import { describe, expect, it } from "vitest";
import {
  estimateSends,
  inSendingWindow,
  isValidTimeZone,
  accountGapMs,
  jitteredGapMs,
  minGapMs,
  nextWindowOpening,
  startOfZonedDay,
  validateCampaignSettings,
  zonedParts,
} from "@/lib/campaigns/schedule";
import { DEFAULT_CAMPAIGN_SETTINGS, type CampaignSettings } from "@/lib/campaigns/types";
import {
  GENERIC_STAGE_LABELS,
  GOAL_GROUPS,
  GOAL_KINDS,
  goalLabel,
  labelKindFor,
  NEXT_ACTIONS,
  nextStepParts,
  OPPORTUNITY_KINDS,
  STAGE_LABELS_BY_KIND,
  stageLabel,
} from "@/lib/constants";

describe("goals", () => {
  it("lists every goal kind once, grouped, with stage names", () => {
    expect(OPPORTUNITY_KINDS).toBe(GOAL_KINDS);
    const values = GOAL_KINDS.map((k) => k.value);
    expect(new Set(values).size).toBe(17);
    for (const old of ["booking", "fundraising", "partnership", "grant", "press", "sale", "other"]) expect(values).toContain(old);
    for (const k of GOAL_KINDS) {
      expect(GOAL_GROUPS.some((g) => g.value === k.group)).toBe(true);
      expect(Object.keys(STAGE_LABELS_BY_KIND[k.value]).sort()).toEqual(["contacted", "lead", "lost", "negotiation", "proposal", "won"]);
    }
    expect(goalLabel("venue")).toBe("Use of a space");
    expect(goalLabel(null)).toBe("Other");
  });

  it("names stages per goal, generic for mixed lists", () => {
    expect(stageLabel("proposal", "booking")).toBe("Offer sent");
    expect(stageLabel("won", "venue")).toBe("Granted");
    expect(stageLabel("won", "fundraising")).toBe("Donated");
    expect(stageLabel("won", "sponsorship")).toBe("Sponsored");
    expect(stageLabel("proposal", "grant")).toBe("Applied");
    expect(stageLabel("lost", "grant")).toBe("Rejected");
    expect(stageLabel("lead", "press")).toBe("To pitch");
    expect(stageLabel("won", "introduction")).toBe("Introduced");
    expect(stageLabel("won", "coproduction")).toBe("Agreed");
    expect(stageLabel("won", "exchange")).toBe("Agreed");
    expect(stageLabel("won")).toBe("Achieved");
    expect(stageLabel("proposal", null)).toBe(GENERIC_STAGE_LABELS.proposal);
    expect(labelKindFor([])).toBe("booking");
    expect(labelKindFor(["booking", "booking"])).toBe("booking");
    expect(labelKindFor(["press"])).toBe("press");
    expect(labelKindFor(["booking", "venue"])).toBeNull();
  });

  it("describes a next step as label · detail · date", () => {
    expect(NEXT_ACTIONS).toHaveLength(14);
    expect(nextStepParts({ nextAction: "call", nextStep: " ask for dates ", followUpAt: "2026-10-05" })).toEqual({
      action: "call",
      label: "Call",
      icon: "Phone",
      detail: "ask for dates",
      date: "2026-10-05",
      text: "Call · ask for dates",
    });
    expect(nextStepParts({ nextAction: null, nextStep: "Send rider", followUpAt: null })).toMatchObject({ label: null, icon: null, text: "Send rider" });
    expect(nextStepParts({ nextAction: null, nextStep: null, followUpAt: null }).text).toBe("");
  });
});

describe("campaign schedule", () => {
  const madrid: CampaignSettings = { ...DEFAULT_CAMPAIGN_SETTINGS, timezone: "Europe/Madrid" };
  // Monday 2026-10-05.
  const at = (iso: string) => new Date(iso);

  it("validates settings", () => {
    expect(validateCampaignSettings({})).toEqual({ ok: true, settings: DEFAULT_CAMPAIGN_SETTINGS });
    expect(validateCampaignSettings({ perHour: 0 })).toMatchObject({ ok: false, error: expect.stringMatching(/per hour/) });
    expect(validateCampaignSettings({ perHour: 61 }).ok).toBe(false);
    expect(validateCampaignSettings({ perHour: 2.5 }).ok).toBe(false);
    expect(validateCampaignSettings({ dailyCap: 401 }).ok).toBe(false);
    expect(validateCampaignSettings({ windowStart: 10, windowEnd: 10 })).toMatchObject({ ok: false, error: expect.stringMatching(/after they start/) });
    expect(validateCampaignSettings({ windowStart: 0, windowEnd: 24 }).ok).toBe(true);
    expect(validateCampaignSettings({ timezone: "Mars/Olympus" }).ok).toBe(false);
    expect(validateCampaignSettings({ perHour: 20, timezone: "America/New_York" })).toMatchObject({
      ok: true,
      settings: { perHour: 20, dailyCap: 40, timezone: "America/New_York" },
    });
    expect(isValidTimeZone("Europe/Madrid")).toBe(true);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("knows the sending window in the campaign's timezone", () => {
    // 07:30 UTC = 09:30 in Madrid (CEST) on a Monday.
    expect(zonedParts(at("2026-10-05T07:30:00Z"), "Europe/Madrid")).toEqual({ date: "2026-10-05", hour: 9, minute: 30, weekday: 1 });
    expect(inSendingWindow(madrid, at("2026-10-05T07:30:00Z"))).toBe(true);
    expect(inSendingWindow(madrid, at("2026-10-05T06:59:00Z"))).toBe(false); // 08:59
    expect(inSendingWindow(madrid, at("2026-10-05T17:00:00Z"))).toBe(false); // 19:00, the end is excluded
    expect(inSendingWindow(madrid, at("2026-10-05T16:59:00Z"))).toBe(true);
    // Saturday.
    expect(inSendingWindow(madrid, at("2026-10-10T10:00:00Z"))).toBe(false);
    expect(inSendingWindow({ ...madrid, weekdaysOnly: false }, at("2026-10-10T10:00:00Z"))).toBe(true);
    // Same instant, New York: 06:00 → closed.
    expect(inSendingWindow({ ...madrid, timezone: "America/New_York" }, at("2026-10-05T10:00:00Z"))).toBe(false);
  });

  it("finds the next opening", () => {
    // Monday 20:00 Madrid → Tuesday 09:00 Madrid (07:00 UTC).
    expect(nextWindowOpening(madrid, at("2026-10-05T18:00:00Z")).toISOString()).toBe("2026-10-06T07:00:00.000Z");
    // Friday evening → Monday 09:00.
    expect(nextWindowOpening(madrid, at("2026-10-09T18:00:00Z")).toISOString()).toBe("2026-10-12T07:00:00.000Z");
    // Early Monday → the same morning.
    expect(nextWindowOpening(madrid, at("2026-10-05T03:00:00Z")).toISOString()).toBe("2026-10-05T07:00:00.000Z");
    // Inside: now.
    expect(nextWindowOpening(madrid, at("2026-10-05T10:00:00Z")).toISOString()).toBe("2026-10-05T10:00:00.000Z");
    // Across the DST change (Oct 25, 2026): Monday 26th 09:00 CET = 08:00 UTC.
    expect(nextWindowOpening(madrid, at("2026-10-23T18:00:00Z")).toISOString()).toBe("2026-10-26T08:00:00.000Z");
    expect(startOfZonedDay("2026-10-05", "Europe/Madrid").toISOString()).toBe("2026-10-04T22:00:00.000Z");
  });

  it("spaces sends with a stable ±40% jitter, and keeps 2 to 4 minutes between an account's sends", () => {
    expect(minGapMs(10)).toBe(360_000);
    expect(minGapMs(60)).toBe(60_000);
    const gaps = Array.from({ length: 200 }, (_, i) => jitteredGapMs(10, `c:${i}`));
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(216_000);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(504_000);
    expect(new Set(gaps).size).toBeGreaterThan(50);
    expect(jitteredGapMs(10, "same")).toBe(jitteredGapMs(10, "same"));
    const account = Array.from({ length: 200 }, (_, i) => accountGapMs(`a:${i}`));
    expect(Math.min(...account)).toBeGreaterThanOrEqual(120_000);
    expect(Math.max(...account)).toBeLessThanOrEqual(240_000);
  });

  it("estimates the next and the last send", () => {
    const monday = at("2026-10-05T07:00:00Z"); // 09:00 Madrid
    expect(estimateSends(madrid, { count: 0, now: monday })).toEqual({ next: null, finish: null });
    // 10 an hour, 40 a day: 40 on Monday (09:00 → 12:54), the last 20 on Tuesday.
    const plan = estimateSends(madrid, { count: 60, now: monday });
    expect(plan.next?.toISOString()).toBe("2026-10-05T07:00:00.000Z");
    expect(plan.finish?.toISOString()).toBe("2026-10-06T08:54:00.000Z"); // Tue 09:00 + 19 × 6 min = 10:54 Madrid
    // Already 40 today → tomorrow.
    expect(estimateSends(madrid, { count: 1, now: monday, sentToday: 40 }).next?.toISOString()).toBe("2026-10-06T07:00:00.000Z");
    // The gap counts from the last send.
    expect(estimateSends(madrid, { count: 1, now: monday, lastSentAt: at("2026-10-05T06:58:00Z") }).next?.toISOString()).toBe(
      "2026-10-05T07:04:00.000Z",
    );
    // The window caps the day as well: 2 hours at 10/h = 20 a day.
    const short = estimateSends({ ...madrid, windowStart: 9, windowEnd: 11 }, { count: 25, now: monday });
    expect(short.finish?.toISOString()).toBe("2026-10-06T07:24:00.000Z");
  });
});
