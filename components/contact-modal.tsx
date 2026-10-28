"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/sheet";

/** A contact card shown over the current page; closing goes back to it. */
export function ContactModal({ children }: { children: ReactNode }) {
  const router = useRouter();
  return (
    <Sheet open onClose={() => router.back()} title="Contact" variant="panel" className="md:w-[min(72rem,94vw)]">
      {children}
    </Sheet>
  );
}
