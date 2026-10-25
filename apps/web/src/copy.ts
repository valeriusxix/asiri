// All user-facing strings live here (Agent.md Section 11.3).
//
// Everything between the @claim-default markers is shown on the default claim path and is scanned by
// scripts/check-copy.mjs. It must never contain: wallet, seed, blockchain, ZEC, shielded, address,
// crypto, token, transaction. Those words are allowed only in `claimAdvanced`, below the end marker.

// @claim-default:start
export const claim = {
  incompleteLink: "This link is incomplete. Ask the sender to send it again.",
};
// @claim-default:end
