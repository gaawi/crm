import Link from "next/link";
import type { Metadata } from "next";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/layout";
import { listOrganizations } from "@/lib/queries/organizations";
import { listProjects } from "@/lib/queries/projects";
import { NewContactForm } from "./new-contact-form";

export const metadata: Metadata = { title: "New contact" };

export default async function NewContactPage() {
  const [projects, organizations] = await Promise.all([listProjects(), listOrganizations({ limit: 500 })]);
  const organizationNames = organizations.map((o) => o.name).sort((a, b) => a.localeCompare(b));

  return (
    <div className="max-w-2xl">
      <Link href="/contacts" className="mb-3 inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
        <ChevronLeft className="size-3.5" strokeWidth={1.75} />
        Contacts
      </Link>
      <PageHeader
        title="New contact"
        description="Existing email with these addresses shows up on the contact right away."
      />
      <NewContactForm
        projects={projects.map((p) => ({ id: p.id, name: p.name, color: p.color }))}
        organizations={organizationNames}
      />
    </div>
  );
}
