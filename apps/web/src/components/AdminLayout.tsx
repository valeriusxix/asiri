import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router";
import { api } from "../api";
import { admin as t } from "../copy";
import { Logo, NetworkPill } from "./Layout";
import { Spinner } from "./ui";

const navClass = ({ isActive }: { isActive: boolean }) =>
  `whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${isActive ? "bg-ink text-white" : "text-black/60 hover:bg-black/5 hover:text-ink"}`;

/** Admin shell (max width 1040 px). Redirects to /login without a session. */
export function AdminLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.auth.me().then(
      (me) => alive && setEmail(me.email),
      () => alive && navigate("/login", { replace: true }),
    );
    return () => {
      alive = false;
    };
  }, [navigate]);

  if (!email) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-black/50">
        <Spinner className="size-7" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#f4f4f1]">
      <header className="border-b border-black/[0.07] bg-white">
        <div className="mx-auto flex max-w-[1040px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
          <Logo />
          <NetworkPill />
          <nav className="order-last -mx-1 flex w-full gap-1 overflow-x-auto sm:order-none sm:ml-4 sm:w-auto">
            <NavLink to="/admin" end className={navClass}>
              {t.navDashboard}
            </NavLink>
            <NavLink to="/admin/payouts/new" className={navClass}>
              {t.navNew}
            </NavLink>
            <NavLink to="/admin/reports" className={navClass}>
              {t.navReports}
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <Link to="/transparency" className="hidden font-medium text-black/55 hover:text-ink sm:inline">
              {t.viewSite}
            </Link>
            <button
              type="button"
              className="rounded-lg px-2 py-1.5 font-semibold text-black/60 hover:bg-black/5 hover:text-ink"
              title={email}
              onClick={async () => {
                await api.auth.logout().catch(() => {});
                navigate("/login");
              }}
            >
              {t.logout}
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1040px] px-4 pb-16 pt-6">{children}</main>
    </div>
  );
}
