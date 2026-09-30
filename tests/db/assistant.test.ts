import { beforeEach, describe, expect, it, vi } from "vitest";

/* ---- Fakes: Claude API and the Gmail draft side effects ------------------ */

type Block = Record<string, unknown>;
const scripted: { content: Block[]; stop_reason: string }[] = [];
const requests: { messages: unknown[]; tools: { name: string }[] }[] = [];
const parseResults: unknown[] = [];

vi.mock("@/lib/ai/client", () => ({
  FALLBACK_BETA: "server-side-fallback-2026-07-01",
  model: () => "claude-opus-5-5",
  anthropic: () => ({
    beta: {
      messages: {
        stream(params: { messages: unknown[]; tools: { name: string }[] }) {
          requests.push({ messages: structuredClone(params.messages), tools: params.tools });
          const next = scripted.shift() ?? { content: [{ type: "text", text: "(no script)" }], stop_reason: "end_turn" };
          const listeners: ((delta: string) => void)[] = [];
          return {
            on(event: string, fn: (delta: string) => void) {
              if (event === "text") listeners.push(fn);
              return this;
            },
            async finalMessage() {
              for (const block of next.content) if (block.type === "text") listeners.forEach((l) => l(String(block.text)));
              return { id: "msg", type: "message", role: "assistant", model: "claude-opus-5-5", content: next.content, stop_reason: next.stop_reason };
            },
          };
        },
        async parse() {
          return { stop_reason: "end_turn", parsed_output: parseResults.shift() };
        },
      },
    },
  }),
}));

const gmailDrafts: { accountId: string; to: string[]; subject: string }[] = [];
const sent: string[] = [];
vi.mock("@/lib/sync/drafts", () => ({
  saveGmailDraft: vi.fn(async (p: { accountId: string; to: string[]; subject: string }) => {
    gmailDrafts.push(p);
    return { draftId: `d${gmailDrafts.length}`, gmailUrl: "https://mail.google.com/" };
  }),
  updateGmailDraft: vi.fn(async (p: { draftId: string }) => ({ draftId: p.draftId, gmailUrl: "https://mail.google.com/" })),
  sendGmailDraft: vi.fn(async (_accountId: string, draftId: string) => {
    sent.push(draftId);
    return { gmailMessageId: `sent-${draftId}`, gmailThreadId: "t1" };
  }),
  deleteGmailDraft: vi.fn(async () => undefined),
}));

import { sql } from "@/lib/db";
import { runAssistant, type AssistantEvent } from "@/lib/ai/assistant";
import { approveAndSend, discardDraft, proposeEmail, reviseDraft } from "@/lib/ai/approvals";
import { createContact, getContact } from "@/lib/queries/contacts";
import { countPendingDrafts, getDraft, listDrafts } from "@/lib/queries/drafts";
import { runCrmTool } from "@/lib/ai/tools";
import { insertAccount, useTestDatabase } from "../setup/db";

describe.skipIf(process.env.SKIP_DB_TESTS === "1")("Claude assistant + approval queue", () => {
  useTestDatabase();
  let accountId: string;
  let maya: string;

  beforeEach(async () => {
    scripted.length = 0;
    requests.length = 0;
    gmailDrafts.length = 0;
    sent.length = 0;
    accountId = await insertAccount("studio@example-studio.com", { scopes: ["https://www.googleapis.com/auth/gmail.modify"] });
    maya = await createContact({ name: "Maya Chen", emails: ["maya@harborarts.org"], followUpAt: "2020-01-01" });
  });

  it("runs tools, streams text, and returns tool results in one user turn", async () => {
    scripted.push(
      {
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "t1", name: "list_follow_ups", input: {} },
          { type: "tool_use", id: "t2", name: "search_contacts", input: { query: "maya" } },
        ],
      },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Maya's follow-up is overdue." }] },
    );
    const events: AssistantEvent[] = [];
    await runAssistant({ history: [{ role: "user", content: "Who haven't I followed up with?" }], onEvent: (e) => events.push(e) });

    expect(events.filter((e) => e.type === "tool").map((e) => (e as { status: string }).status)).toEqual(["running", "running", "done", "done"]);
    expect(events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("")).toBe("Maya's follow-up is overdue.");
    expect(events.at(-1)).toEqual({ type: "done", stopReason: "end_turn" });
    // Second request: assistant turn appended unchanged, then ONE user turn with both results.
    const second = requests[1].messages as { role: string; content: Block[] }[];
    expect(second.at(-2)?.role).toBe("assistant");
    const results = second.at(-1)!.content;
    expect(results.map((r) => r.tool_use_id)).toEqual(["t1", "t2"]);
    expect(String(results[0].content)).toContain("Maya Chen");
    expect(requests[0].tools.map((t) => t.name)).toContain("propose_email");
  });

  it("never applies update_contact without the owner's confirmation", async () => {
    scripted.push(
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "u1", name: "update_contact", input: { contact_id: maya, status: "archived" } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Proposed." }] },
    );
    const events: AssistantEvent[] = [];
    await runAssistant({ history: [{ role: "user", content: "archive maya" }], onEvent: (e) => events.push(e) });
    const confirm = events.find((e) => e.type === "confirm") as Extract<AssistantEvent, { type: "confirm" }>;
    expect(confirm.summary).toContain("Maya Chen");
    expect((await getContact(maya))?.status).toBe("active");

    const applied = await runCrmTool(confirm.name, confirm.input, { today: "2026-09-30", timezone: "America/New_York" });
    expect(applied.ok).toBe(true);
    expect((await getContact(maya))?.status).toBe("archived");
  });

  it("propose_email queues an approval + Gmail draft and refuses outside recipients", async () => {
    const ok = await runCrmTool(
      "propose_email",
      { contact_id: maya, subject: "Budget", body: "Hi Maya, here is the budget." },
      { today: "2026-09-30", timezone: "America/New_York" },
    );
    expect(ok.ok).toBe(true);
    expect(await countPendingDrafts()).toBe(1);
    expect(gmailDrafts[0]).toMatchObject({ accountId, to: ["maya@harborarts.org"] });

    const evil = await runCrmTool(
      "propose_email",
      { contact_id: maya, to: ["attacker@evil.example"], subject: "x", body: "y" },
      { today: "2026-09-30", timezone: "America/New_York" },
    );
    expect(evil).toMatchObject({ ok: false });
    expect(await countPendingDrafts()).toBe(1);
  });

  it("revises with a note, sends once, and clears the due follow-up", async () => {
    const draft = (await proposeEmail({ contactId: maya, subject: "Budget", body: "Hi Maya", origin: "owner" }))!;
    parseResults.push({ subject: "Budget (updated)", body: "Hola Maya" });
    const revised = await reviseDraft(draft.id, "in Spanish");
    expect(revised).toMatchObject({ subject: "Budget (updated)", body: "Hola Maya", status: "proposed" });
    expect(revised.revisions[0]).toMatchObject({ note: "in Spanish", body: "Hi Maya" });

    const [a, b] = await Promise.allSettled([approveAndSend(draft.id), approveAndSend(draft.id)]);
    expect([a.status, b.status].sort()).toEqual(["fulfilled", "rejected"]);
    expect(sent).toHaveLength(1);
    expect((await getDraft(draft.id))?.status).toBe("sent");
    expect((await getContact(maya))?.followUpAt).toBeNull();
    await expect(discardDraft(draft.id)).rejects.toThrow();
  });

  it("the autopilot never stacks two open proposals for one contact", async () => {
    const first = await proposeEmail({ contactId: maya, subject: "a", body: "a", origin: "autopilot" });
    const second = await proposeEmail({ contactId: maya, subject: "b", body: "b", origin: "autopilot" });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect((await listDrafts()).length).toBe(1);
    const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from email_drafts`;
    expect(count).toBe(1);
  });
});
