import "server-only";
import { sql } from "@/lib/db";
import { repairMojibake } from "@/lib/text/mojibake";

const BATCH = 200;

export interface MojibakeRepairResult {
  checked: number;
  repaired: number;
  /** Resume after this message id; null once every message was checked. */
  cursor: string | null;
}

/**
 * Restore stored message bodies saved before the parser read Gmail's UTF-8
 * bodies as UTF-8 (lib/gmail/parse.ts decodeBodyBytes). Walks messages in id
 * order from `cursor` until `deadline`; only rows that change are written.
 */
export async function repairStoredMojibake(options: { cursor?: string | null; deadline: number }): Promise<MojibakeRepairResult> {
  let cursor = options.cursor ?? null;
  let checked = 0;
  let repaired = 0;
  while (Date.now() < options.deadline) {
    const rows = await sql<{ id: string; bodyText: string }[]>`
      select id, body_text from messages
       where (${cursor}::uuid is null or id > ${cursor}::uuid)
         and body_text ~ '[ÃÂÄÅĂĹâ][\u0080-˿‐-›€™]'
       order by id
       limit ${BATCH}`;
    if (rows.length === 0) return { checked, repaired, cursor: null };
    for (const row of rows) {
      const fixed = repairMojibake(row.bodyText);
      if (fixed !== row.bodyText) {
        await sql`update messages set body_text = ${fixed} where id = ${row.id}`;
        repaired++;
      }
    }
    checked += rows.length;
    cursor = rows[rows.length - 1].id;
  }
  return { checked, repaired, cursor };
}
