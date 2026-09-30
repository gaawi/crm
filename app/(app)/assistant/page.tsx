import type { Metadata } from "next";
import { AssistantChat } from "./chat";

export const metadata: Metadata = { title: "Claude" };

export default function AssistantPage() {
  return <AssistantChat />;
}
