import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { VelaMark } from "@/components/brand/vela-logo";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  if (await isAuthenticated()) redirect("/");
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-xs">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <VelaMark size={56} tile />
          <h1 className="text-2xl font-semibold tracking-[0.01em] text-brand-ink">Vela</h1>
        </div>
        <LoginForm next={typeof next === "string" ? next : "/"} />
      </div>
    </div>
  );
}
