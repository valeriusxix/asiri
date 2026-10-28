# Asiri roadmap

No dates. Items move when they are ready, not on a calendar.

## What stays the same

Every item below keeps these three things true:

1. **Recipients need nothing.** No wallet, app, seed phrase or crypto knowledge. A link and a PIN are enough.
2. **No recipient identity.** Asiri never collects names or phone numbers, and never stores bank details.
3. **Anyone can check the totals.** Donors and the public verify the fund through its Zcash viewing key.

If an idea breaks one of these, it is not on this list.

"Partly built" means some of it is in the code today. The note says what exists.

## Next

Small extensions of what exists.

- **Receiver chooses the withdrawal currency on the cash-out screen.**
  Partly built: the demo cash-out screen exists, with a bank form for each currency. Today it always uses the payout's own currency.
- **More currencies and languages, added from the existing config.**
  Partly built: NGN, USD, GBP and CAD come from one currency definition per app (`apps/api/src/lib/currency.ts`, mirrored in `apps/web/src/currency.ts`). All page text lives in `apps/web/src/copy.ts`, but there is no language switch yet.
- **Share links through more channels: Telegram, Signal, email, printable QR code.**
  Partly built: the link can be sent by WhatsApp or SMS, and the PIN by SMS. There's a QR component, but only the donate page uses it.
- **Mainnet launch after a security review.**
  Partly built: `ZCASH_NETWORK=mainnet` is a setting. The real-wallet path has only been run on testnet so far. Before launch, organizers also need a way to settle a payout stuck in `claiming` against the wallet.
- **Several funds on one deployment, each with its own viewing key and transparency page.**
  Not built. Today one deployment serves one fund.

## Later

These need partners or deeper engineering.

- **Real cash-out to bank accounts and mobile money, through licensed off-ramp partners, region by region.**
  Partly built: the bank forms are a demo. They check the format and then discard the details. `OFFRAMP_ZCASH_ADDRESS` shows where the funds would go.
- **Real card and bank donations, through a licensed payments partner.**
  Partly built: a demo donation tab exists. It is labelled "Demo" and never counted as money raised.
- **Multi-organizer approval with FROST threshold signing, so no single person can move funds.**
  Not built. Today the server holds the fund's spending key.
- **One-time wallet per link ("Mode B" in Agent.md, section 10.5), so the server holds less.**
  Designed, not built.
- **Donations from other chains, swapped into shielded ZEC.**
  Not built.
- **Partial withdrawals from a single link.**
  Not built. Today a link is claimed in one go.

## Exploring

A bigger direction, under the same principles.

- **Opening Asiri to individuals and small businesses, not just community funds.**
  Examples: payroll, tips, and payouts to creators and freelancers.
  This brings licensing and compliance work in each region. That work has to be done first, region by region.
  Not built.

## What we won't do

- **A WhatsApp or Telegram bot that collects bank details in chat.**
  The details would sit in chat history and pass through third parties.
- **Collecting recipient phone numbers or identity to send messages for the sender.**
  That would build exactly the list of people Asiri exists to avoid.
- **Publishing recipient-level payout data.**
  Public totals are enough to check the fund. Per-person data puts people at risk.
- **Requiring recipients to install a wallet.**
  A link and a PIN must stay enough.
