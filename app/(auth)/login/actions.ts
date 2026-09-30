"use server";

import { redirect } from "next/navigation";
import { checkPassword, endSession, startSession } from "@/lib/auth";
import { loginBlocked, recordLoginFailure, recordLoginSuccess } from "@/lib/login-throttle";

export interface LoginState {
  error?: string;
}

function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  // Only same-origin paths.
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const password = String(formData.get("password") ?? "");
  if (await loginBlocked()) {
    return { error: "Too many attempts. Try again in 15 minutes." };
  }
  if (!password || !checkPassword(password)) {
    await recordLoginFailure();
    // Slow down guessing.
    await new Promise((resolve) => setTimeout(resolve, 750));
    return { error: "Wrong password." };
  }
  await recordLoginSuccess();
  await startSession();
  redirect(safeNext(formData.get("next")));
}

export async function logout(): Promise<void> {
  await endSession();
  redirect("/login");
}
