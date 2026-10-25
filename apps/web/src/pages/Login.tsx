import { useState } from "react";
import { useNavigate } from "react-router";
import { ApiError, api } from "../api";
import { Logo, NetworkPill } from "../components/Layout";
import { Alert, Button, Card, Field, Spinner, inputClass } from "../components/ui";
import { admin as t, common } from "../copy";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[#f4f4f1] px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <Logo />
          <NetworkPill />
        </div>
        <Card>
          <h1 className="mb-5 text-xl font-bold">{t.loginTitle}</h1>
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
                setError(code === "invalid_credentials" ? t.badLogin : code === "rate_limited" ? t.rateLimited : code === "network_error" ? common.offline : common.error);
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
            <Button type="submit" variant="dark" size="lg" block disabled={busy}>
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
    </div>
  );
}
