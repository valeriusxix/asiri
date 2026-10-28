import type { ReactNode } from "react";
import { Link, NavLink } from "react-router";
import { common } from "../copy";
import { useHealth } from "../hooks";

export function Logo({ light }: { light?: boolean }) {
  return (
    <Link to="/" className={`inline-flex items-center gap-2 font-bold tracking-tight ${light ? "text-white" : "text-ink"}`}>
      <svg viewBox="0 0 64 64" className="size-7" aria-hidden>
        <rect width="64" height="64" rx="14" fill="#0B0F14" />
        <path d="M32 12 14 52h9l3.6-8.6h10.8L41 52h9L32 12Zm-2.9 24.6L32 29l2.9 7.6h-5.8Z" fill="#F4B728" />
      </svg>
      <span className="text-lg">{common.appName}</span>
    </Link>
  );
}

/**
 * Small "TESTNET" pill whenever the API runs on testnet (Agent.md 11.1). In mock mode no network is used at all,
 * so it reads "DEMO" instead (audit H2, D-031).
 */
export function NetworkPill({ dark }: { dark?: boolean }) {
  const health = useHealth();
  return <NetworkPillView network={health?.network} mode={health?.mode} dark={dark} />;
}

export function NetworkPillView({ network, mode, dark }: { network?: string; mode?: string; dark?: boolean }) {
  const mock = mode === "mock";
  if (!mock && network !== "testnet") return null;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-bold tracking-widest ring-1 ring-inset ${
        dark ? "bg-gold/15 text-gold ring-gold/40" : "bg-amber-50 text-amber-800 ring-amber-300"
      }`}
      title={mock ? common.demoPillTitle : common.testnetTitle}
    >
      {mock ? common.demoPill : common.testnet}
    </span>
  );
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-2.5 py-1.5 text-sm font-semibold transition-colors ${isActive ? "bg-black/5 text-ink" : "text-black/60 hover:text-ink"}`;

/** Public pages: max content width 640 px. */
export function PublicLayout({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-black/[0.06] bg-[#f7f7f5]/90 backdrop-blur">
        <div className={`mx-auto flex h-14 items-center gap-2 px-4 ${wide ? "max-w-[960px]" : "max-w-[640px]"}`}>
          <Logo />
          <NetworkPill />
          <nav className="ml-auto flex items-center gap-0.5">
            <NavLink to="/donate" className={navClass}>
              {common.navDonate}
            </NavLink>
            <NavLink to="/transparency" className={navClass}>
              {common.navTransparency}
            </NavLink>
          </nav>
        </div>
      </header>
      <main className={`mx-auto w-full flex-1 px-4 pb-16 pt-6 ${wide ? "max-w-[960px]" : "max-w-[640px]"}`}>{children}</main>
      <Footer />
    </div>
  );
}

export function Footer({ dark }: { dark?: boolean }) {
  return (
    <footer className={dark ? "bg-ink text-white/50" : "text-black/45"}>
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
      <h1 className="text-[1.75rem] font-bold leading-tight tracking-tight text-ink">{title}</h1>
      {sub && <p className="mt-1.5 text-base text-black/60">{sub}</p>}
    </div>
  );
}
