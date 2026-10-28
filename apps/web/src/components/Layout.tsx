import type { ReactNode } from "react";
import { Link } from "react-router";
import { common } from "../copy";
import { Navbar } from "./Navbar";

export { Logo, NetworkPill, NetworkPillView } from "./Navbar";

/** Public pages: max content width 640 px. */
export function PublicLayout({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const width = wide ? "max-w-[960px]" : "max-w-[640px]";
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <Navbar variant="public" width={width} />
      <main className={`mx-auto w-full flex-1 px-4 pb-16 pt-6 ${width}`}>{children}</main>
      <Footer />
    </div>
  );
}

export function Footer({ dark }: { dark?: boolean }) {
  return (
    <footer className={dark ? "bg-brand-ink text-white/60" : "text-subtle"}>
      <div className="mx-auto flex max-w-[960px] flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm">
        <span>{common.footer}</span>
        <Link to="/admin" className="font-medium underline-offset-4 hover:underline">
          {common.navOrganizers}
        </Link>
      </div>
    </footer>
  );
}

export function PageTitle({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-[1.75rem] font-bold leading-tight tracking-tight text-fg">{title}</h1>
      {sub && <p className="mt-1.5 text-base text-muted">{sub}</p>}
    </div>
  );
}
