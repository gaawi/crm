import mark from "@/lib/brand/vela-mark.json";
import { cn } from "@/lib/utils";

/**
 * Vela's mark: a curved sail over a swoosh of wave. Same geometry as the
 * generated icons (lib/brand/vela-mark.json → scripts/generate-brand-icons.mjs).
 *
 *   tone="brand"   in the brand blue (lighter in dark mode)
 *   tone="current" in currentColor (inherits text color)
 *   tile           white mark on a rounded brand square (like the app icon)
 *   motion="rock"  the loader: the sail rocks gently while the wave rolls
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
  const ink = tile ? "#fff" : "currentColor";
  const s = mark.tileScale;
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
      {tile ? <rect width="32" height="32" rx={mark.tileRadius} className="fill-brand" /> : null}
      <g transform={tile ? `translate(${16 * (1 - s)} ${16 * (1 - s)}) scale(${s})` : undefined}>
        <path d={mark.sail} fill={ink} className={motion === "rock" ? "vela-sail" : undefined} />
        <path d={mark.wave} fill={ink} className={motion === "rock" ? "vela-wave" : undefined} />
      </g>
    </svg>
  );
}

/** Mark + "Vela" wordmark (app font, semibold, in dark navy like the logo). */
export function VelaLogo({ size = 22, className, wordmarkClassName }: { size?: number; className?: string; wordmarkClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <VelaMark size={size} />
      <span className={cn("font-semibold tracking-[0.01em] text-brand-ink", wordmarkClassName)}>Vela</span>
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
