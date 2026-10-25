import { useEffect, useState } from "react";
import { api } from "../api";
import type { Health } from "../types";

export function Home() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.health().then(setHealth, () => setError(true));
  }, []);

  return (
    <main className="min-h-dvh bg-ink text-white">
      <div className="mx-auto max-w-[640px] px-5 py-16">
        <p className="text-sm font-semibold tracking-widest text-gold">ASIRI</p>
        <h1 className="mt-3 text-4xl font-bold leading-tight">Private money you can send like a message.</h1>
        <p className="mt-4 text-lg text-white/75">
          Asiri helps community funds pay people quickly and privately. Recipients need only a phone.
        </p>
        <p className="mt-10 text-sm text-white/60" data-testid="health">
          {health ? `API ok · ${health.mode} · ${health.network}` : error ? "API unreachable" : "Checking API…"}
        </p>
      </div>
    </main>
  );
}
