import { VelaLoader } from "@/components/brand/vela-logo";

/**
 * Shown the moment a conversation is tapped, while Gmail sends it. Same
 * frame as the thread page (sidebar rail, bars) so nothing jumps.
 */
export default function ThreadLoading() {
  return (
    <div className="md:flex md:h-dvh" data-testid="thread-loading">
      <div className="hidden shrink-0 border-r border-border bg-surface md:block md:w-[4.25rem] 2xl:w-60" />
      <div className="flex min-w-0 flex-1 flex-col bg-surface">
        <div className="sticky top-0 z-20 h-11 border-b border-border bg-bg/85 pt-[env(safe-area-inset-top)] backdrop-blur-xl box-content md:hidden" />
        <div className="hidden h-16 shrink-0 border-b border-border md:block" />
        <div className="hidden h-12 shrink-0 border-b border-border md:block" />
        <div className="space-y-4 px-4 py-6 md:px-6">
          <div className="h-6 w-2/3 animate-pulse rounded bg-border/60" />
          <div className="flex items-center gap-3">
            <div className="size-10 animate-pulse rounded-full bg-border/60" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-40 animate-pulse rounded bg-border/60" />
              <div className="h-3 w-24 animate-pulse rounded bg-border/50" />
            </div>
          </div>
          <div className="space-y-2 pt-2">
            <div className="h-3 w-full animate-pulse rounded bg-border/50" />
            <div className="h-3 w-11/12 animate-pulse rounded bg-border/50" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-border/50" />
          </div>
          <div className="flex flex-col items-center gap-3 pt-10">
            <VelaLoader size={28} className="text-brand opacity-70" label="Loading conversation" />
            <p className="vela-late text-center text-sm text-subtle">Waking up the server, one moment…</p>
          </div>
        </div>
      </div>
    </div>
  );
}
