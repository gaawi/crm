import { UserPlus } from "lucide-react";
import { Field, Input } from "@/components/ui/field";
import { INSTRUMENTS } from "@/lib/musicians/instruments";
import { ActionForm, FormSubmit } from "../_components/action-form";
import { FormActions } from "../_components/ui";
import { addMusicianAction } from "./actions";

/** "Add a musician": a new contact (or the one that already has that email) with its musician card. */
export function AddMusician() {
  return (
    <details className="group rounded-xl border border-border bg-surface md:rounded-lg">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-[15px] text-fg active:opacity-60 md:min-h-10 md:text-sm [&::-webkit-details-marker]:hidden">
        <UserPlus className="size-4 text-muted" aria-hidden />
        Add a musician
      </summary>
      <ActionForm action={addMusicianAction} className="flex flex-col gap-3 px-4 pb-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Name" htmlFor="m-name">
            <Input id="m-name" name="name" required autoComplete="off" autoCapitalize="words" maxLength={300} />
          </Field>
          <Field label="Email" htmlFor="m-email" hint="Optional. If it already belongs to a contact, that contact becomes the musician.">
            <Input id="m-email" name="email" type="email" inputMode="email" autoComplete="off" autoCapitalize="off" />
          </Field>
          <Field label="Instruments / voice" htmlFor="m-instruments" hint="Comma separated: “cello”, “violonchelo, viola da gamba”.">
            <Input id="m-instruments" name="instruments" list="m-instrument-options" required autoComplete="off" autoCapitalize="off" />
            <datalist id="m-instrument-options">
              {INSTRUMENTS.map((i) => (
                <option key={i.key} value={i.label} />
              ))}
            </datalist>
          </Field>
          <Field label="Based in" htmlFor="m-based">
            <Input id="m-based" name="basedIn" placeholder="City, country" autoComplete="off" maxLength={200} />
          </Field>
          <Field label="Website" htmlFor="m-website" className="md:col-span-2">
            <Input id="m-website" name="website" type="text" inputMode="url" autoCapitalize="off" placeholder="https://" autoComplete="off" />
          </Field>
        </div>
        <FormActions>
          <FormSubmit pendingLabel="Adding…">Add musician</FormSubmit>
        </FormActions>
      </ActionForm>
    </details>
  );
}
