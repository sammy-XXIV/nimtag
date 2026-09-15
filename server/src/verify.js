const Nimiq = require('@nimiq/core')

// Proves the claimer controls the address: Nimiq Pay's sign() returns the
// public key and an Ed25519 signature over the message. Wallets differ in
// what exactly they sign (the raw bytes, or a "Nimiq Signed Message" wrapper
// as the Hub does), so every known form is checked.

const PREFIX = '\x16Nimiq Signed Message:\n'

function candidates(message) {
  const enc = new TextEncoder()
  const raw = enc.encode(message)
  const wrapped = enc.encode(PREFIX + raw.length + message)
  return [
    raw,
    wrapped,
    Nimiq.Hash.computeSha256(wrapped),
    Nimiq.Hash.computeSha256(raw),
  ]
}

// Returns the address the signature proves control of, or null.
function recoverAddress({ message, publicKey, signature }) {
  let pk
  let sig
  try {
    pk = Nimiq.PublicKey.fromHex(String(publicKey))
    sig = Nimiq.Signature.fromHex(String(signature))
  } catch {
    return null
  }
  for (const data of candidates(message)) {
    try {
      if (pk.verify(sig, data)) return pk.toAddress().toUserFriendlyAddress()
    } catch {
      /* try the next form */
    }
  }
  return null
}

function isAddress(a) {
  try {
    Nimiq.Address.fromUserFriendlyAddress(String(a))
    return true
  } catch {
    return false
  }
}

function canonical(a) {
  return Nimiq.Address.fromUserFriendlyAddress(String(a)).toUserFriendlyAddress()
}

module.exports = { recoverAddress, isAddress, canonical }
