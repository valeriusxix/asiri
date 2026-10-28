// After a claim, the secret is removed from the address bar (Agent.md 11.2), so a reload would otherwise look like a
// broken link and tell someone who was just paid to "ask the sender again" (audit L2). The tab remembers the claim
// in sessionStorage: nothing but the payout id, gone when the tab closes, and never sent anywhere.

type TabStorage = Pick<Storage, "getItem" | "setItem">;

const key = (id: string) => `asiri:claimed:${id}`;

/** sessionStorage, or null where the browser blocks it (private modes, sandboxed previews). */
export function tabStorage(): TabStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function rememberClaimed(storage: TabStorage | null, id: string): void {
  try {
    storage?.setItem(key(id), "1");
  } catch {
    // Storage full or blocked: the reload just shows the incomplete-link message, as before.
  }
}

export function wasClaimedHere(storage: TabStorage | null, id: string): boolean {
  try {
    return storage?.getItem(key(id)) === "1";
  } catch {
    return false;
  }
}
