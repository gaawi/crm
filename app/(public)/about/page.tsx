import type { Metadata } from "next";
import Link from "next/link";
import { APP_NAME } from "@/lib/legal";

export const metadata: Metadata = { title: APP_NAME };

export default function AboutPage() {
  return (
    <article className="flex flex-col gap-4 text-[15px] leading-relaxed text-fg">
      <h1 className="text-[28px] font-bold leading-tight tracking-tight">{APP_NAME}</h1>
      <p>
        {APP_NAME} is the private tool CreArtBox uses to manage its professional correspondence with venues, partners, funders and
        press: one contact history across its Gmail accounts, follow-up reminders and a simple pipeline.
      </p>
      <p>
        It is an internal tool, not a public service: only the CreArtBox team signs in. Emails are sent only when the owner presses
        Send or approves a draft.
      </p>
      <p>
        Read the <Link href="/privacy" className="underline underline-offset-2">privacy policy</Link> for how Google user data is
        handled. Questions: <a href="mailto:info@creartbox.nyc" className="underline underline-offset-2">info@creartbox.nyc</a>.
      </p>
    </article>
  );
}
