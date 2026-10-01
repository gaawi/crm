import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { AssistantChat } from "./chat";

export const metadata: Metadata = { title: "Claude" };

export default function AssistantPage() {
  // Claude inside the CRM is optional (ANTHROPIC_API_KEY).
  if (!env.claudeEnabled) redirect("/");
  return <AssistantChat />;
}
