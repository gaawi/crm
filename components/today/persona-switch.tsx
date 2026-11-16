import { UserRound } from "lucide-react";
import { setPersona } from "@/app/(app)/actions";
import { PERSONAS, type Persona } from "@/lib/persona";
import { cn } from "@/lib/utils";

/**
 * "I am Guillermo / Josefina": who is using this browser. Today and Approvals
 * then show only that person's emails, mass mailings and booking sheets.
 */
export function PersonaSwitch({ current }: { current: Persona }) {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Who is using this browser">
      <span className="hidden items-center gap-1 text-xs text-muted sm:inline-flex">
        <UserRound className="size-3.5" aria-hidden />I am
      </span>
      <div className="inline-flex rounded-full border border-border bg-surface p-0.5 md:rounded-lg">
        {PERSONAS.map((p) => (
          <form key={p.key} action={setPersona.bind(null, p.key)}>
            <button
              type="submit"
              aria-pressed={current === p.key}
              className={cn(
                "h-8 rounded-full px-3 text-[13px] font-medium transition-colors md:h-7 md:rounded-md md:text-xs",
                current === p.key ? "bg-accent text-accent-fg" : "text-muted hover:text-fg",
              )}
            >
              {p.label}
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}
