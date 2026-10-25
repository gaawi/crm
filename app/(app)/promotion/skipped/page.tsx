import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/layout";
import { listListingPlatforms } from "@/lib/queries/listings";
import { InsetGroup, LinkRow, MethodIcon, methodName } from "../stage";

export const metadata: Metadata = { title: "Not worth it · Promotion" };

/** Sites studied and set aside, kept so nobody researches them again. */
export default async function PromotionSkippedPage() {
  const skipped = (await listListingPlatforms()).filter((p) => p.tier === "skip");
  return (
    <>
      <PageHeader title="Not worth it" back={{ href: "/promotion", label: "Promotion" }} />
      <div className="md:max-w-2xl">
        <InsetGroup footer="Studied and set aside (paid, closed, or the wrong audience). Open one to see why.">
          {skipped.map((p) => (
            <LinkRow key={p.id} href={`/promotion/p/${p.id}`}>
              <MethodIcon method={p.method} />
              <span className="min-w-0 flex-1 truncate text-[17px] text-fg md:text-sm">{p.name}</span>
              <span className="text-[15px] text-subtle md:text-xs">{methodName(p.method)}</span>
            </LinkRow>
          ))}
        </InsetGroup>
      </div>
    </>
  );
}
