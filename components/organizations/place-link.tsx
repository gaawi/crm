import { MapPin } from "lucide-react";
import type { OrgPlace } from "@/lib/organizations/profile";
import { cn } from "@/lib/utils";

/**
 * "Kuopio, Finland" with a pin, opening Google Maps in a new tab. One line,
 * truncated (the full place is in the title). Build `place` with orgPlace();
 * `iconClassName` sets the pin's size (default size-3.5).
 */
export function PlaceLink({
  place,
  className,
  iconClassName,
}: {
  place: Pick<OrgPlace, "label" | "mapsUrl">;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <a
      href={place.mapsUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={`${place.label} — open in Google Maps`}
      data-testid="place-link"
      className={cn("inline-flex min-w-0 max-w-full items-center gap-1 hover:text-fg hover:underline", className)}
    >
      <MapPin className={cn("shrink-0", iconClassName ?? "size-3.5")} strokeWidth={1.75} aria-hidden />
      <span className="truncate">{place.label}</span>
    </a>
  );
}
