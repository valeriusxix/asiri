import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router";
import { api } from "../api";
import logo from "../assets/logo-mark.png";
import { admin as ta, common } from "../copy";
import { useHealth } from "../hooks";

/** Intrinsic size of logo-mark.png. The attributes reserve its box before it loads, so nothing shifts. */
const LOGO_W = 208;
const LOGO_H = 200;

type Tone = "light" | "dark";

/**
 * The logo mark (src/assets/logo-mark.png, bundled and hashed by Vite) and the name beside it: the mark has no
 * wordmark of its own. 32 px tall on phones, 36 px from the sm breakpoint.
 */
export function Logo({ to = "/", tone = "light" }: { to?: string; tone?: Tone }) {
  return (
    <Link
      to={to}
      className={`inline-flex shrink-0 items-center gap-2 rounded-lg font-bold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary ${
        tone === "dark" ? "text-white" : "text-brand-ink"
      }`}
    >
      <img src={logo} alt="Asiri" width={LOGO_W} height={LOGO_H} className="h-8 w-auto select-none sm:h-9" draggable={false} />
      <span className="text-lg sm:text-xl" aria-hidden>
        {common.appName}
      </span>
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
      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tracking-widest ring-1 ring-inset ${
        dark ? "bg-brand-secondary/15 text-brand-secondary ring-brand-secondary/40" : "bg-warning-tint text-warning-text ring-warning-border"
      }`}
      title={mock ? common.demoPillTitle : common.testnetTitle}
    >
      {mock ? common.demoPill : common.testnet}
    </span>
  );
}

type NavbarProps =
  /** Home, donate, transparency, login: logo to "/", plus the public links. */
  | { variant: "public"; tone?: Tone; width?: string; links?: boolean }
  /** The recipient's claim page: logo and network pill only. */
  | { variant: "minimal"; width?: string }
  /** Organizer dashboard: logo to "/admin", dashboard links (a menu on phones), public site and log out. */
  | { variant: "admin"; email: string };

/** One header for every page. */
export function Navbar(props: NavbarProps) {
  if (props.variant === "admin") return <AdminNavbar email={props.email} />;
  const width = props.width ?? "max-w-[640px]";
  const tone = props.variant === "public" ? (props.tone ?? "light") : "light";
  const showLinks = props.variant === "public" && props.links !== false;
  const surface =
    tone === "dark" ? "bg-brand-ink text-white" : "sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur";
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-semibold transition-colors ${
      tone === "dark"
        ? isActive
          ? "bg-white/10 text-white"
          : "text-white/75 hover:text-white"
        : isActive
          ? "bg-brand-primary-tint text-brand-primary-strong"
          : "text-muted hover:text-fg"
    }`;
  return (
    <header className={surface}>
      <div className={`mx-auto flex h-16 w-full items-center gap-2 px-4 ${width}`}>
        <Logo tone={tone} />
        <NetworkPill dark={tone === "dark"} />
        {showLinks && (
          <nav className="ml-auto flex min-w-0 items-center gap-0.5">
            <NavLink to="/donate" className={linkClass}>
              {common.navDonate}
            </NavLink>
            <NavLink to="/transparency" className={linkClass}>
              {common.navTransparency}
            </NavLink>
          </nav>
        )}
      </div>
    </header>
  );
}

const ADMIN_LINKS = [
  { to: "/admin", label: ta.navDashboard, end: true },
  { to: "/admin/payouts/new", label: ta.navNew, end: false },
  { to: "/admin/reports", label: ta.navReports, end: false },
];

function AdminNavbar({ email }: { email: string }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  // Close the phone menu after every navigation.
  useEffect(() => setOpen(false), [pathname]);

  const logout = async () => {
    await api.auth.logout().catch(() => {});
    navigate("/login");
  };
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
      isActive ? "bg-brand-primary-tint text-brand-primary-strong" : "text-muted hover:bg-surface-muted hover:text-fg"
    }`;
  const quiet = "rounded-lg px-3 py-2 text-sm font-semibold text-muted hover:bg-surface-muted hover:text-fg";

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1120px] items-center gap-3 px-4">
        <Logo to="/admin" />
        <NetworkPill />
        <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label={ta.navDashboard}>
          {ADMIN_LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={linkClass}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-1 md:flex">
          <Link to="/transparency" className={quiet}>
            {ta.viewSite}
          </Link>
          <button type="button" className={quiet} title={email} onClick={logout}>
            {ta.logout}
          </button>
        </div>
        <button
          type="button"
          className="ml-auto inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-fg ring-1 ring-inset ring-border-strong hover:bg-surface-muted md:hidden"
          aria-expanded={open}
          aria-controls="admin-menu"
          onClick={() => setOpen((v) => !v)}
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
          {open ? common.closeMenu : common.menu}
        </button>
      </div>
      {open && (
        <nav id="admin-menu" className="border-t border-border bg-surface px-4 pb-3 pt-2 md:hidden" aria-label={ta.navDashboard}>
          <div className="mx-auto flex max-w-[1120px] flex-col gap-1">
            {ADMIN_LINKS.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={linkClass}>
                {l.label}
              </NavLink>
            ))}
            <div className="my-1 border-t border-border" />
            <Link to="/transparency" className={quiet}>
              {ta.viewSite}
            </Link>
            <button type="button" className={`${quiet} text-left`} onClick={logout}>
              {ta.logout} <span className="font-normal text-subtle">({email})</span>
            </button>
          </div>
        </nav>
      )}
    </header>
  );
}
