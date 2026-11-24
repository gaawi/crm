import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";

export const metadata: Metadata = { title: "Mail" };

/**
 * Shared by every mail page. The composer and optimistic state live in the
 * app layout (AppMailProvider), so a message being written survives
 * navigation, inside Mail and out of it. `data-fullbleed` opts out of the
 * app's centered max-width column.
 */
export default async function MailLayout({ children }: LayoutProps<"/mail">) {
  await requireSession();
  return (
    <div data-fullbleed className="min-w-0">
      {children}
    </div>
  );
}
