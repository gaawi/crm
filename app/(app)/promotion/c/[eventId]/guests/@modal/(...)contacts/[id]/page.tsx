import ContactPage from "@/app/(app)/contacts/[id]/page";
import { ContactModal } from "@/components/contact-modal";

/**
 * A person tapped on a guest list: their full contact card over the list.
 * Opened from a link (a reload or a shared link shows the normal contact page).
 */
// Intercepting routes are not in the generated route types: typed by hand.
export default function ContactOverList({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <ContactModal>
      <ContactPage params={params} searchParams={searchParams} />
    </ContactModal>
  );
}
