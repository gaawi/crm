import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { repairStoredMojibake } from "@/lib/sync/repair-mojibake";
import { insertAccount, useTestDatabase } from "../setup/db";

describe("repairStoredMojibake", () => {
  useTestDatabase();

  it("restores broken accents in stored bodies and leaves the rest alone", async () => {
    const account = await insertAccount("me@own.test", { status: "active" });
    const insert = (id: string, body: string) => sql`
      insert into messages (account_id, gmail_message_id, gmail_thread_id, direction, from_email, subject, body_text, sent_at)
      values (${account}, ${id}, ${id}, 'inbound', 'ana@venue.test', 'Hola', ${body}, now())`;
    await insert("a", "Buenos dÃ­as: estÃ¡ previsto");
    await insert("b", "Klemen RamovĹĄ");
    await insert("c", "Café mañana");

    const result = await repairStoredMojibake({ deadline: Date.now() + 10_000 });
    expect(result).toEqual({ checked: 2, repaired: 2, cursor: null });
    const bodies = await sql<{ id: string; bodyText: string }[]>`select gmail_message_id id, body_text from messages order by 1`;
    expect(bodies.map((b) => b.bodyText)).toEqual(["Buenos días: está previsto", "Klemen Ramovš", "Café mañana"]);
  });
});
