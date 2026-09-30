import { Field, Input, Textarea } from "@/components/ui/field";
import { PROJECT_COLOR_NAMES, PROJECT_COLORS } from "@/lib/constants";
import { cn } from "@/lib/utils";

/** Name, color swatches and description; shared by the create and edit forms. */
export function ProjectFields({
  name = "",
  color = "gray",
  description = "",
  autoFocus = false,
}: {
  name?: string;
  color?: string;
  description?: string;
  autoFocus?: boolean;
}) {
  return (
    <>
      <Field label="Name" htmlFor="project-name">
        <Input id="project-name" name="name" required defaultValue={name} autoFocus={autoFocus} autoComplete="off" />
      </Field>
      <fieldset>
        <legend className="mb-1.5 text-xs font-medium text-muted">Color</legend>
        <div className="flex flex-wrap gap-1.5">
          {PROJECT_COLOR_NAMES.map((c) => (
            <label key={c} title={c} className="cursor-pointer">
              <input type="radio" name="color" value={c} defaultChecked={c === color} className="peer sr-only" />
              <span
                className={cn(
                  "flex size-10 items-center justify-center rounded-full ring-1 ring-border transition peer-checked:ring-2 peer-checked:ring-fg peer-focus-visible:ring-2 peer-focus-visible:ring-ring md:size-7",
                )}
              >
                <span className={cn("size-6 rounded-full md:size-4", PROJECT_COLORS[c].dot)} />
              </span>
              <span className="sr-only">{c}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Description" htmlFor="project-description">
        <Textarea id="project-description" name="description" rows={3} defaultValue={description} />
      </Field>
    </>
  );
}
