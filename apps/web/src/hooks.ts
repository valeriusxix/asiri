import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Health } from "./types";

let healthPromise: Promise<Health> | null = null;

/** /api/health, fetched once per page load and shared by every component. */
export function useHealth(): Health | null {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    healthPromise ??= api.health().catch((err: unknown) => {
      healthPromise = null;
      throw err;
    });
    let alive = true;
    healthPromise.then(
      (h) => alive && setHealth(h),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, []);
  return health;
}

export interface AsyncState<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

/** Runs `fn` on mount (and on reload). Ignores results that arrive after unmount. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [state, setState] = useState<{ data: T | null; error: unknown; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fnRef.current().then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (error: unknown) => alive && setState({ data: null, error, loading: false }),
    );
    return () => {
      alive = false;
    };
  }, [tick, ...deps]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

/** Copy text to the clipboard, with a fallback for older Android browsers. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  }
}
