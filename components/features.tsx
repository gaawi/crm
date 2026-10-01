"use client";

import { createContext, useContext, type ReactNode } from "react";

/** Optional features, decided on the server (env) and read by client components. */
const ClaudeEnabled = createContext(false);

export function FeaturesProvider({ claude, children }: { claude: boolean; children: ReactNode }) {
  return <ClaudeEnabled.Provider value={claude}>{children}</ClaudeEnabled.Provider>;
}

/** Claude inside the CRM is on only when ANTHROPIC_API_KEY is set. */
export function useClaudeEnabled(): boolean {
  return useContext(ClaudeEnabled);
}
