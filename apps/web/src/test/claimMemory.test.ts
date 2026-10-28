import { describe, expect, it } from "vitest";
import { rememberClaimed, wasClaimedHere } from "../claimMemory";
import { claim } from "../copy";

const memoryStorage = () => {
  const items = new Map<string, string>();
  return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), items };
};

describe("a reload after a claim does not say the link is broken (audit L2)", () => {
  it("remembers a claim for this tab, per payout", () => {
    const storage = memoryStorage();
    expect(wasClaimedHere(storage, "AAAAAAAAAA")).toBe(false);
    rememberClaimed(storage, "AAAAAAAAAA");
    expect(wasClaimedHere(storage, "AAAAAAAAAA")).toBe(true);
    expect(wasClaimedHere(storage, "BBBBBBBBBB")).toBe(false);
  });

  it("stores only the payout id: no secret, PIN, token or bank details", () => {
    const storage = memoryStorage();
    rememberClaimed(storage, "AAAAAAAAAA");
    expect([...storage.items]).toEqual([["asiri:claimed:AAAAAAAAAA", "1"]]);
  });

  it("falls back to the old behaviour when storage is blocked or missing", () => {
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => rememberClaimed(blocked, "AAAAAAAAAA")).not.toThrow();
    expect(wasClaimedHere(blocked, "AAAAAAAAAA")).toBe(false);
    expect(wasClaimedHere(null, "AAAAAAAAAA")).toBe(false);
  });

  it("tells the recipient they were paid, in plain words", () => {
    expect(claim.claimedHereTitle).toBe("You have received this support");
    expect(claim.claimedHere).not.toMatch(/again|incomplete/i);
  });
});
