import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { claim, claimAdvanced } from "../copy";
import { DoneDetails } from "../pages/Claim";

const text = (el: ReactElement) => renderToStaticMarkup(el).replace(/<[^>]+>/g, " ");
const TXID = "e50c15de6c0d0838a68115af8e97098543b477012b3c7e2f4134d63ff798648f";

describe("the done screen is honest about bank cash-outs (audit L3)", () => {
  it("a demo cash-out says no real bank transfer happened, with a Demo badge", () => {
    const out = text(<DoneDetails result={{ status: "claimed", method: "cashout_demo", demo: true }} />);
    expect(out).toContain(claim.doneBank);
    expect(out).toContain("Demo");
  });

  it("says the same when OFFRAMP_ZCASH_ADDRESS sent real funds on chain (demo: false)", () => {
    const out = text(<DoneDetails result={{ status: "claimed", method: "cashout_demo", demo: false, txid: TXID }} />);
    expect(out).toContain(claim.doneBank);
    expect(out).toContain("Demo");
    expect(out).not.toMatch(/has been sent/);
  });

  it("a wallet send shows the transaction id", () => {
    const out = text(<DoneDetails result={{ status: "claimed", method: "zcash_address", demo: false, txid: TXID }} />);
    expect(out).toContain(claimAdvanced.doneWallet);
    expect(out).toContain(TXID);
    expect(out).not.toContain("Demo");
  });
});
