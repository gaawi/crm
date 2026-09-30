import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/layout";
import { listOrganizations } from "@/lib/queries/organizations";
import { listProjects } from "@/lib/queries/projects";
import { param } from "../../_lib/url";
import { NewContactForm } from "./new-contact-form";

export const metadata: Metadata = { title: "New contact" };

export default async function NewContactPage({ searchParams }: PageProps<"/contacts/new">) {
  const sp = await searchParams;
  const [projects, organizations] = await Promise.all([listProjects(), listOrganizations({ limit: 500 })]);
  const organizationNames = organizations.map((o) => o.name).sort((a, b) => a.localeCompare(b));
  const org = param(sp, "org", 300);
  // Coming from an organization's People list: "‹ <Organization>" goes back there.
  const fromOrg = org ? organizations.find((o) => o.name.toLowerCase() === org.toLowerCase()) : undefined;

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="New contact"
        description="Existing email with these addresses shows up on the contact right away."
        back={fromOrg ? { href: `/organizations/${fromOrg.id}?tab=people`, label: fromOrg.name } : { href: "/contacts", label: "Contacts" }}
      />
      <NewContactForm
        projects={projects.map((p) => ({ id: p.id, name: p.name, color: p.color }))}
        organizations={organizationNames}
        defaultOrganization={fromOrg?.name ?? org}
        defaultEmail={param(sp, "email", 300)}
      />
    </div>
  );
}
