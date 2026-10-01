"use server";

import { redirect } from "next/navigation";
import { checkPassword, endSession, startSession } from "@/lib/auth";
import { recordLoginSuccess, reserveLoginAttempt } from "@/lib/login-throttle";
import { safeNext } from "./safe-next";

export interface LoginState {
  error?: string;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const password = String(formData.get("password") ?? "");
  if (!(await reserveLoginAttempt())) {
    return { error: "Too many attempts. Try again in 15 minutes." };
  }
  if (!password || !checkPassword(password)) {
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
