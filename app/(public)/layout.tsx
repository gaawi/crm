import Link from "next/link";
import { APP_NAME } from "@/lib/legal";

/** Public pages (no sign-in): the home page and privacy policy for Google's consent screen. */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-[calc(env(safe-area-inset-top)+2rem)]">
      <header className="mb-8 flex items-center justify-between gap-3">
        <Link href="/about" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="inline-block size-5 rounded-md bg-accent" aria-hidden />
          {APP_NAME}
        </Link>
        <Link href="/login" className="text-sm text-muted hover:text-fg">
          Sign in
        </Link>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="mt-12 flex gap-4 text-xs text-subtle">
        <Link href="/about" className="hover:text-muted">
          About
        </Link>
        <Link href="/privacy" className="hover:text-muted">
          Privacy policy
        </Link>
        <a href="mailto:info@creartbox.nyc" className="hover:text-muted">
          info@creartbox.nyc
        </a>
      </footer>
    </div>
  );
}
