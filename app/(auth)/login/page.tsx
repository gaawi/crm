import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  if (await isAuthenticated()) redirect("/");
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-xs">
        <div className="mb-6 flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="inline-block size-5 rounded-md bg-accent" aria-hidden />
          CRM
        </div>
        <LoginForm next={typeof next === "string" ? next : "/"} />
      </div>
    </div>
  );
}
