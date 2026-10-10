import { useId } from "react";
import mark from "@/lib/brand/vela-mark.json";
import { cn } from "@/lib/utils";

/**
 * Vela's mark: a mainsail whose three thin lines read as a musical staff,
 * over a soft wave. The lines are cut out of the sail (a mask), so the mark
 * works on any background. Same geometry as the generated icons
 * (lib/brand/vela-mark.json → scripts/generate-brand-icons.mjs).
 *
 *   tone="brand"  sail in the brand indigo (lighter in dark mode)
 *   tone="current" sail in currentColor (inherits text color)
 *   tile          white mark on a rounded brand square (like the app icon)
 *   motion="rock" the loader: the sail rocks gently and its lines fill
 */
export function VelaMark({
  size = 20,
  tone = "brand",
  tile = false,
  motion,
  className,
  title,
}: {
  size?: number;
  tone?: "brand" | "current";
  tile?: boolean;
  motion?: "rock";
  className?: string;
  /** Accessible name; without it the mark is decorative. */
  title?: string;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const maskId = `vela-staff-${id}`;
  const ink = tile ? "#fff" : "currentColor";
  return (
    <svg
      viewBox={mark.viewBox}
      width={size}
      height={size}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn("shrink-0", !tile && tone === "brand" && "text-brand", motion === "rock" && "vela-rock", className)}
    >
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">
          <rect width="32" height="32" fill="#fff" />
          <g stroke="#000" strokeWidth={1.1} fill="none" className={motion === "rock" ? "vela-staff" : undefined}>
            {mark.staff.map((d) => (
              <path key={d} d={d} />
            ))}
          </g>
        </mask>
      </defs>
      {tile ? <rect width="32" height="32" rx={mark.tileRadius} className="fill-brand" /> : null}
      <g className={motion === "rock" ? "vela-sail" : undefined}>
        <path d={mark.mast} stroke={ink} strokeWidth={1.5} strokeLinecap="round" fill="none" />
        <path d={mark.sail} fill={ink} mask={`url(#${maskId})`} />
      </g>
      <path d={mark.wave} stroke={ink} strokeWidth={1.5} strokeLinecap="round" fill="none" className={motion === "rock" ? "vela-wave" : undefined} />
    </svg>
  );
}

/** Mark + "Vela" wordmark (app font, medium weight, a little letter-spacing). */
export function VelaLogo({ size = 22, className, wordmarkClassName }: { size?: number; className?: string; wordmarkClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <VelaMark size={size} />
      <span className={cn("font-medium tracking-[0.04em] text-fg", wordmarkClassName)}>Vela</span>
    </span>
  );
}

/**
 * The branded loader: the sail rocking on its wave (static with reduced
 * motion). `label` is announced to screen readers.
 */
export function VelaLoader({ size = 20, label = "Loading", className }: { size?: number; label?: string; className?: string }) {
  return (
    <span role="status" className={cn("inline-flex items-center", className)}>
      <VelaMark size={size} motion="rock" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
