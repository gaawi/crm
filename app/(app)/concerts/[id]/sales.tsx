"use client";

import { useId, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Field, Input } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { ActionForm } from "../../_components/action-form";
import { addTicketChannelAction, removeTicketChannelAction, updateTicketSaleAction } from "../actions";
import { rowClass } from "../../promotion/stage";

export interface SaleRow {
  id: string;
  channel: string;
  sold: number | null;
  note: string | null;
}

function SaleFields({ id, sale }: { id: string; sale?: SaleRow }) {
  return (
    <>
      <Field label="Tickets sold (total so far)" htmlFor={`${id}-sold`}>
        <Input
          id={`${id}-sold`}
          name="sold"
          type="number"
          min={0}
          inputMode="numeric"
          placeholder="Empty = not reported"
          defaultValue={sale?.sold ?? ""}
          autoFocus={Boolean(sale)}
        />
      </Field>
      <Field label="Note (optional)" htmlFor={`${id}-note`}>
        <Input id={`${id}-note`} name="note" maxLength={500} placeholder="as of Oct 26, comps not included…" defaultValue={sale?.note ?? ""} />
      </Field>
    </>
  );
}

/**
 * The channels of a concert: tap one to type its number by hand (ChatGPT
 * usually keeps them up to date), or add a channel at the end.
 */
export function SalesRows({ eventId, sales }: { eventId: string; sales: SaleRow[] }) {
  const [editing, setEditing] = useState<SaleRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const id = useId();
  const formId = `${id}-sale`;
  const close = () => {
    setEditing(null);
    setAdding(false);
    setConfirm(false);
  };

  return (
    <>
      {sales.map((s) => (
        <li key={s.id}>
          <button type="button" onClick={() => setEditing(s)} className={cn(rowClass, "w-full text-left active:bg-surface-2 md:hover:bg-surface-2")}>
            <span className="min-w-0 flex-1 text-[17px] text-fg md:text-sm">
              {s.channel}
              {s.note ? <span className="block truncate text-[13px] text-subtle md:text-xs">{s.note}</span> : null}
            </span>
            <span className={cn("shrink-0 text-[17px] tabular-nums md:text-sm", s.sold === null ? "text-subtle" : "text-fg")}>{s.sold ?? "Not reported"}</span>
          </button>
        </li>
      ))}
      <li>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className={cn(rowClass, "w-full text-left text-[17px] text-blue-600 active:bg-surface-2 md:text-sm md:hover:bg-surface-2 dark:text-blue-400")}
        >
          <Plus className="size-5" aria-hidden />
          Add a channel
        </button>
      </li>
      {editing ? (
        <Sheet open onClose={close} title={editing.channel} primary={{ label: "Save", form: formId }}>
          <ActionForm id={formId} action={updateTicketSaleAction.bind(null, editing.id)} onDone={close} className="flex flex-col gap-3">
            <SaleFields id={id} sale={editing} />
            <button
              type="button"
              disabled={pending}
              onClick={() => (confirm ? start(async () => void (await removeTicketChannelAction(editing.id).catch(() => null), close())) : setConfirm(true))}
              className={cn(
                "mt-2 flex min-h-11 items-center justify-center gap-2 rounded-xl border text-[15px] md:min-h-9 md:text-sm",
                confirm ? "border-red-600 bg-red-600 text-white" : "border-border text-danger",
              )}
            >
              <Trash2 className="size-4" aria-hidden />
              {confirm ? "Tap again to remove" : "Remove this channel"}
            </button>
          </ActionForm>
        </Sheet>
      ) : null}
      {adding ? (
        <Sheet open onClose={close} title="Add a channel" primary={{ label: "Add", form: formId }}>
          <ActionForm id={formId} action={addTicketChannelAction.bind(null, eventId)} onDone={close} className="flex flex-col gap-3">
            <Field label="Channel" htmlFor={`${id}-channel`}>
              <Input id={`${id}-channel`} name="channel" required maxLength={80} placeholder="Goldstar, at the door…" autoFocus />
            </Field>
            <SaleFields id={id} />
          </ActionForm>
        </Sheet>
      ) : null}
    </>
  );
}
