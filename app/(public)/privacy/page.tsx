import type { Metadata } from "next";
import Markdown from "react-markdown";
import { APP_NAME, PRIVACY_POLICY_MD } from "@/lib/legal";

export const metadata: Metadata = { title: `Privacy policy — ${APP_NAME}` };

export default function PrivacyPage() {
  return (
    <article className="prose-chat text-[15px] leading-relaxed text-fg">
      <h1 className="mb-4 text-[28px] font-bold leading-tight tracking-tight">Privacy policy</h1>
      <Markdown components={{ img: () => null }}>{PRIVACY_POLICY_MD}</Markdown>
    </article>
  );
}
