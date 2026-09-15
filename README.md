# Nimtag

**Send NIM to a name, not an address.**

A [Nimiq Pay](https://nimiq.com/nimiq-pay) mini app. Claim `@you`, then anyone
can send you NIM by typing your name — no 36-character address, no QR, no
copy-paste. Free, no fees, your wallet stays yours.

## How it works

- **Claim.** Type a name. Your wallet signs a short message (`Claim @name on
  Nimtag / Address / Time`) with `sign()` from the Mini Apps SDK; the server
  verifies the Ed25519 signature with `@nimiq/core`, checks it matches the
  address, and registers the name. Nothing is sent on-chain. One name per
  wallet; claiming a new one releases the old.
- **Send.** Type `@name`, it resolves to the address — shown with the wallet's
  own Nimiq identicon so you can see it's the right person — set an amount,
  and Nimiq Pay's approval sheet sends it (`sendBasicTransactionWithData`, with
  `@you → @them` as the memo).
- **Share.** Every name has a page, `/@name`, that opens in Nimiq Pay with the
  Send screen ready.

## Repository

```
app/      React + Vite mini app
server/   Express: name registry (file on a Railway volume), signature check,
          serves the built app with /@name deep links
```

## Security

- A name can only be claimed by a signature from the wallet that owns the
  address, over a message that includes the name, the address and a timestamp
  (valid for 10 minutes) — no replay for another name or later.
- Reserved names (`nimiq`, `admin`, …), 3–20 chars, letters/digits/underscore.
- Per-IP rate limits on claims and lookups.

## License

MIT — see [LICENSE](LICENSE).
