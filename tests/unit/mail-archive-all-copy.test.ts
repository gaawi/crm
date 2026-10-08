import { describe, expect, it } from "vitest";
import { archiveQuestion, archiveScopeLabel, archivedMessage, conversations } from "@/components/mail/archive-all-copy";

describe("Archive all wording", () => {
  it("names the scope: tab or every tab, one account or all", () => {
    expect(archiveScopeLabel("primary", "all accounts")).toBe("Inbox · Primary · all accounts");
    expect(archiveScopeLabel("promotions", "me@example.com")).toBe("Inbox · Promotions · me@example.com");
    expect(archiveScopeLabel(null, "all accounts")).toBe("Inbox · all tabs · all accounts");
  });

  it("asks with the count (and says where the mail stays)", () => {
    const scope = archiveScopeLabel("primary", "all accounts");
    expect(archiveQuestion(1234, scope)).toBe("Archive all 1,234 conversations in Inbox · Primary · all accounts? They stay in All Mail and search.");
    expect(archiveQuestion(1, scope)).toBe("Archive the 1 conversation in Inbox · Primary · all accounts? It stays in All Mail and search.");
    expect(archiveQuestion(null, scope)).toBe("Archive all conversations in Inbox · Primary · all accounts? They stay in All Mail and search.");
  });

  it("counts conversations in English", () => {
    expect(conversations(0)).toBe("0 conversations");
    expect(conversations(1)).toBe("1 conversation");
    expect(conversations(20000)).toBe("20,000 conversations");
  });

  it("reports the result", () => {
    expect(archivedMessage({ archived: 37, more: false, warnings: [] })).toBe("37 conversations archived.");
    expect(archivedMessage({ archived: 1, more: false, warnings: [] })).toBe("1 conversation archived.");
    expect(archivedMessage({ archived: 0, more: false, warnings: [] })).toBe("Nothing to archive: the inbox was already empty.");
    expect(archivedMessage({ archived: 20000, more: true, warnings: [] })).toBe(
      "20,000 conversations archived. More are still in the inbox: choose Archive all again to continue.",
    );
  });

  it("mentions accounts that were left out", () => {
    expect(archivedMessage({ archived: 5, more: false, warnings: ["Reconnect b@example.com in Settings to allow changes"] })).toBe(
      "5 conversations archived. Reconnect b@example.com in Settings to allow changes.",
    );
    expect(
      archivedMessage({
        archived: 0,
        more: false,
        warnings: ["a@example.com: Gmail error (500): backend error.", "Reconnect b@example.com in Settings to allow changes"],
      }),
    ).toBe("Nothing was archived. 2 accounts were left out: a@example.com: Gmail error (500): backend error; Reconnect b@example.com in Settings to allow changes.");
  });
});
