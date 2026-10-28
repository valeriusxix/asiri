import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { api } from "../api";
import { Navbar } from "./Navbar";
import { Spinner } from "./ui";

/** Admin shell (max width 1120 px). Redirects to /login without a session. */
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
      <div className="flex min-h-dvh items-center justify-center bg-background text-subtle">
        <Spinner className="size-7" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background">
      <Navbar variant="admin" email={email} />
      <main className="mx-auto max-w-[1120px] px-4 pb-16 pt-6 sm:pt-8">{children}</main>
    </div>
  );
}
