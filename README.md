# Nimtag

**Send NIM to a name, not an address.**

Nimiq Pay is the wallet. Nimtag is who you send to.

A [Nimiq Pay](https://nimiq.com/nimiq-pay) mini app. Claim `@you` once — free,
permanent, proven by your wallet's signature — and from then on anyone with
Nimiq Pay can pay you by typing your name. No 36-character address, no QR, no
copy-paste, and no account: the wallet you're already inside is the identity.

Live: **https://nimtag-production.up.railway.app** (open it from inside Nimiq Pay)

## What it does

- **Claim your name.** Type a name; your wallet signs a short message to prove
  the address is yours; the name is yours for good. One name per wallet, no
  changing it later — so a name always means the same person.
- **Send by name.** Type `@ada`, see her Nimiq identicon and address, enter an
  amount, approve in Nimiq Pay. The transaction carries `@you → @ada` as its
  memo, so the payment is readable on-chain by anyone.
- **Your card.** A printed pass with your identicon, `@name`, address and link —
  `nimtag…/@you` — that opens straight into Send for whoever taps it.
- **Request NIM.** `…/@you?amount=50` opens Nimiq Pay with Send pre-filled.
  Paste it in any chat.
- **People.** Who you've paid and who's paid you, by name, from the chain —
  tap to send again. Addresses without a name are one tap from getting your link.
- **People on Nimtag.** Recently claimed names, so there's always someone to
  send to.

Nothing is stored about you beyond the name → address pair, which is public
by design.

## How it works

```
Nimiq Pay ── listAccounts() ──▶ your address
                │
   type @you ──▶ sign("Claim @you on Nimtag / Address / Time")   (in the wallet)
                │
   server: verify Ed25519 signature ── public key must hash to the address
           timestamp within 10 min ── name free, not reserved ── wallet unnamed
                │
           registry: @you → address                (file on a persistent volume)

   type @ada ──▶ /api/tags/ada ──▶ address + identicon
   amount   ──▶ sendBasicTransactionWithData(address, luna, "@you → @ada")
                                                   (Nimiq Pay's own approval sheet)
```

- **Claiming** never touches the chain. The wallet signs a message that
  includes the name, the address and a timestamp; the server checks the
  signature with `@nimiq/core`, checks the public key derives the claimed
  address, and checks the time. A signature can't be replayed for another name
  or later, because both are inside the signed text.
- **Sending** is a normal Nimiq transaction from the wallet. Nimtag never holds
  funds or keys; it only resolves the name.
- **Balance, people and history** come from a public Albatross RPC node. Because
  every Nimtag send carries `@from → @to` in the memo, the chain is the record —
  there's no server-side history to keep or lose.

## Repository

```
app/      React + Vite mini app (wallet.js wraps the Mini Apps SDK; Identicon.jsx
          renders Nimiq's own identicons)
server/   Express: name registry (names.js), signature verification (verify.js),
          RPC-backed balance/activity, serves the built app with /@name deep links
```

Run locally with `DEV_MODE=true node server/src/server.js` and `npm run dev` in
`app/`: outside Nimiq Pay the dev build uses a mock wallet so the whole flow can
be clicked through. The mock is compiled out of production builds, and the server
only honours it when `DEV_MODE` is set.

## Security

- A name can only be claimed with a signature from the wallet that owns the
  address, over a message that binds name + address + time.
- Names are permanent: one per wallet, never released or transferred.
- Reserved names (`nimiq`, `admin`, `support`, …); `3–20` characters,
  letters/digits/underscore, must start with a letter.
- Per-IP rate limits; 16 KB request bodies; no secrets on the server.

## Roadmap

- USDT and the other tokens Nimiq Pay holds (EVM sends need gas, so it's a
  different UX).
- Require a funded wallet to claim, so free keypairs can't squat names.
- Admin takedown for impersonation.

## License

MIT — see [LICENSE](LICENSE).
