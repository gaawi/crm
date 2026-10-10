import { VelaLoader } from "@/components/brand/vela-logo";

/** Route loading state: the Vela sail rocking, centered and quiet. */
export default function Loading() {
  return (
    <div className="flex min-h-[50dvh] items-center justify-center" data-testid="route-loading">
      <VelaLoader size={36} className="text-brand opacity-80" />
    </div>
  );
}
