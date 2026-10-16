import { VelaLoader } from "@/components/brand/vela-logo";

/** Route loading state: the Vela sail rocking, centered and quiet. A note appears if it takes a while. */
export default function Loading() {
  return (
    <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-3" data-testid="route-loading">
      <VelaLoader size={36} className="text-brand opacity-80" />
      <p className="vela-late px-6 text-center text-sm text-subtle">Waking up the server, one moment…</p>
    </div>
  );
}
