"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createContact, EmailTakenError, getContact } from "@/lib/queries/contacts";
import { errorMessage } from "@/lib/utils";
import {
  field,
  idList,
  longText,
  optionalDateSchema,
  parseEmailList,
  parseTags,
  shortText,
  statusSchema,
} from "../../_lib/validation";

export interface NewContactValues {
  name: string;
  emails: string;
  organization: string;
  role: string;
  status: string;
  projectIds: string[];
  tags: string;
  followUpAt: string;
  followUpNote: string;
  notes: string;
}

export interface NewContactState {
  error?: string;
  /** The address already belongs to this contact. */
  taken?: { email: string; contactId: string; displayName: string };
  /** What was submitted, so the form can be refilled after an error. */
  values?: NewContactValues;
}

const schema = z.object({
  name: shortText,
  organization: shortText,
  role: shortText,
  status: statusSchema,
  tags: z.string().max(2000),
  followUpAt: optionalDateSchema,
  followUpNote: shortText,
  notes: longText,
});

export async function createContactAction(_prev: NewContactState, formData: FormData): Promise<NewContactState> {
  await requireSession();

  const values: NewContactValues = {
    name: field(formData, "name"),
    emails: field(formData, "emails"),
    organization: field(formData, "organization"),
    role: field(formData, "role"),
    status: field(formData, "status") || "active",
    projectIds: idList(formData, "projectIds"),
    tags: field(formData, "tags"),
    followUpAt: field(formData, "followUpAt"),
    followUpNote: field(formData, "followUpNote"),
    notes: field(formData, "notes"),
  };

  const parsed = schema.safeParse(values);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const label = { followUpAt: "Follow-up date", status: "Status" }[String(issue?.path[0])] ?? "A field";
    return { error: `${label} is invalid.`, values };
  }
  const input = parsed.data;

  const { emails, invalid } = parseEmailList(values.emails);
  if (invalid) return { error: `“${invalid}” is not a valid email address.`, values };
  if (!input.name && !emails.length) return { error: "Add a name or at least one email address.", values };

  let id: string;
  try {
    id = await createContact({
      name: input.name || null,
      emails,
      organizationName: input.organization || null,
      role: input.role || null,
      status: input.status,
      projectIds: values.projectIds,
      tags: parseTags(input.tags),
      followUpAt: input.followUpAt,
      followUpNote: input.followUpNote || null,
      notes: input.notes || null,
    });
  } catch (error) {
    if (error instanceof EmailTakenError) {
      const owner = await getContact(error.contactId);
      return {
        error: `${error.email} already belongs to another contact.`,
        taken: { email: error.email, contactId: error.contactId, displayName: owner?.displayName ?? error.email },
        values,
      };
    }
    return { error: errorMessage(error), values };
  }

  redirect(`/contacts/${id}`);
}
