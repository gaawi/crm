"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { addTicketChannel, removeTicketChannel, updateTicketSale } from "@/lib/queries/ticket-sales";
import { errorMessage } from "@/lib/utils";
import type { ActionResult } from "../_components/action-form";
import { field, parseId } from "../_lib/validation";

function saleFields(formData: FormData) {
  const sold = field(formData, "sold").trim();
  return {
    sold: sold === "" ? null : Number(sold),
    note: field(formData, "note").trim().slice(0, 500) || null,
  };
}

async function save(run: () => Promise<unknown>, message: string): Promise<ActionResult> {
  await requireSession();
  try {
    await run();
  } catch (error) {
    return { error: errorMessage(error) };
  }
  revalidatePath("/concerts", "layout");
  return { message };
}

/** The number of a channel, typed in by hand (empty = not reported). */
export async function updateTicketSaleAction(saleId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return save(() => updateTicketSale(parseId(saleId), saleFields(formData)), "Saved.");
}

export async function addTicketChannelAction(eventId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const channel = field(formData, "channel").trim().slice(0, 80);
  if (!channel) return { error: "Name the channel." };
  return save(() => addTicketChannel(parseId(eventId), { channel, ...saleFields(formData) }), "Added.");
}

export async function removeTicketChannelAction(saleId: string): Promise<{ ok: boolean }> {
  const result = await save(() => removeTicketChannel(parseId(saleId)), "Removed.");
  return { ok: !result.error };
}
