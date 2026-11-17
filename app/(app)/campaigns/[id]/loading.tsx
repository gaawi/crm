import { VelaLoader } from "@/components/brand/vela-logo";

/**
 * Shown the moment a campaign is tapped (Next prefetches it with the link), while
 * the sheet loads: the outline of the page and a few gray rows.
 */
export default function Loading() {
  return (
    <div
      data-fullbleed
      className="mx-auto w-full max-w-[1500px] px-4 pb-24 pt-[calc(env(safe-area-inset-top)+0.5rem)] md:px-8 md:pt-4"
      data-testid="campaign-loading"
    >
      <div className="mb-4 h-8 w-2/3 max-w-md animate-pulse rounded-md bg-surface-2" />
      <div className="mb-3 flex gap-2">
        <div className="h-10 flex-1 animate-pulse rounded-full bg-surface-2 md:max-w-sm" />
        <div className="h-10 w-24 animate-pulse rounded-full bg-surface-2" />
      </div>
      <div className="mb-4 h-5 w-3/4 max-w-lg animate-pulse rounded bg-surface-2" />
      <div className="mb-4 flex items-center justify-center gap-2 text-sm text-muted">
        <VelaLoader size={20} className="text-brand" label="Loading the campaign" /> Loading the campaign…
      </div>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
        {Array.from({ length: 8 }, (_, i) => (
          <li key={i} className="flex flex-col gap-1.5 border-l-4 border-l-surface-2 px-3 py-3">
            <span className="h-4 w-1/2 animate-pulse rounded bg-surface-2" />
            <span className="h-3 w-1/3 animate-pulse rounded bg-surface-2" />
          </li>
        ))}
      </ul>
    </div>
  );
}
