import "server-only";
import type { Project } from "@/lib/types";

/** Ordered by sort_order, name. Counts exclude archived contacts and closed opportunities. */
export async function listProjects(options: { includeArchived?: boolean } = {}): Promise<Project[]> {
  void options;
  throw new Error("TODO");
}

export async function getProject(id: string): Promise<Project | null> {
  void id;
  throw new Error("TODO");
}

/** Case-insensitive name match. */
export async function getProjectByName(name: string): Promise<Project | null> {
  void name;
  throw new Error("TODO");
}

export interface ProjectInput {
  name?: string;
  color?: string;
  description?: string | null;
  archived?: boolean;
  sortOrder?: number;
}

export async function createProject(input: ProjectInput & { name: string }): Promise<string> {
  void input;
  throw new Error("TODO");
}

export async function updateProject(id: string, patch: ProjectInput): Promise<void> {
  void id;
  void patch;
  throw new Error("TODO");
}

export async function deleteProject(id: string): Promise<void> {
  void id;
  throw new Error("TODO");
}
