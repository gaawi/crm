"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { updateContact } from "@/lib/queries/contacts";
import { parseId } from "../_lib/validation";

const triageStatus = z.enum(["active", "archived"]);

/** Review of an auto-created contact: "Keep" → active, "Archive" → archived. */
export async function triageContact(contactId: string, status: "active" | "archived"): Promise<void> {
  await requireSession();
  await updateContact(parseId(contactId), { status: triageStatus.parse(status) });
  refresh();
}
