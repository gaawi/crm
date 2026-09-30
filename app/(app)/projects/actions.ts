"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { PROJECT_COLOR_NAMES } from "@/lib/constants";
import { addContactsToProject, removeContactFromProject } from "@/lib/queries/contacts";
import { createProject, deleteProject, getProjectByName, updateProject } from "@/lib/queries/projects";
import { errorMessage } from "@/lib/utils";
import type { ActionResult } from "../_components/action-form";
import { field, parseId, shortText } from "../_lib/validation";

const projectSchema = z.object({
  name: shortText.min(1, "Name is required."),
  color: z.enum(PROJECT_COLOR_NAMES as [string, ...string[]]).catch("gray"),
  description: z.string().trim().max(2000),
});

function readProject(formData: FormData) {
  return projectSchema.safeParse({
    name: field(formData, "name"),
    color: field(formData, "color"),
    description: field(formData, "description"),
  });
}

export async function createProjectAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireSession();
  const parsed = readProject(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Some fields are invalid." };
  let id: string;
  try {
    id = await createProject({ ...parsed.data, description: parsed.data.description || null });
  } catch (error) {
    return { error: errorMessage(error) };
  }
  redirect(`/projects/${id}`);
}

export async function updateProjectAction(projectId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireSession();
  const id = parseId(projectId);
  const parsed = readProject(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Some fields are invalid." };
  const existing = await getProjectByName(parsed.data.name);
  if (existing && existing.id !== id) return { error: `A project named “${existing.name}” already exists.` };
  try {
    await updateProject(id, { ...parsed.data, description: parsed.data.description || null });
  } catch (error) {
    return { error: errorMessage(error) };
  }
  redirect(`/projects/${id}`);
}

export async function setProjectArchived(projectId: string, archived: boolean): Promise<void> {
  await requireSession();
  await updateProject(parseId(projectId), { archived: z.boolean().parse(archived) });
  refresh();
}

export async function deleteProjectAction(projectId: string): Promise<void> {
  await requireSession();
  await deleteProject(parseId(projectId));
  redirect("/projects");
}

export async function addProjectMember(projectId: string, contactId: string): Promise<void> {
  await requireSession();
  await addContactsToProject([parseId(contactId)], parseId(projectId));
  refresh();
}

export async function removeProjectMember(projectId: string, contactId: string): Promise<void> {
  await requireSession();
  await removeContactFromProject(parseId(contactId), parseId(projectId));
  refresh();
}
