import { useState } from "react";
import { useNavigate } from "react-router";
import { ApiError, api } from "../api";
import { Navbar } from "../components/Navbar";
import { Alert, Button, Card, Field, Spinner, inputClass } from "../components/ui";
import { admin as t, common } from "../copy";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <Navbar variant="public" links={false} width="max-w-[1120px]" />
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-10 sm:items-center sm:pt-0">
      <div className="w-full max-w-sm">
        <Card className="p-6!">
          <div className="mb-5 h-1.5 w-12 rounded-full bg-brand-primary" aria-hidden />
          <h1 className="mb-5 text-xl font-bold text-fg">{t.loginTitle}</h1>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                await api.auth.login(email, password);
                navigate("/admin", { replace: true });
              } catch (err) {
                const code = err instanceof ApiError ? err.code : "";
                setError(loginError(code));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label={t.email} htmlFor="email">
              <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
            </Field>
            <Field label={t.password} htmlFor="password">
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </Field>
            {error && <Alert>{error}</Alert>}
            <Button type="submit" size="lg" block disabled={busy}>
              {busy ? (
                <>
                  <Spinner /> {t.loggingIn}
                </>
              ) : (
                t.login
              )}
            </Button>
          </form>
        </Card>
      </div>
      </main>
    </div>
  );
}

/** The message for a failed login, by API error code. */
export function loginError(code: string): string {
  switch (code) {
    case "invalid_credentials":
      return t.badLogin;
    case "rate_limited":
      return t.rateLimited;
    case "https_required":
      return t.httpsRequired;
    case "network_error":
      return common.offline;
    default:
      return common.error;
  }
}
