const path = require('path')
const express = require('express')
const names = require('./names')
const { recoverAddress, isAddress, canonical } = require('./verify')

const app = express()
app.set('trust proxy', 1)
app.use(express.json({ limit: '16kb' }))

const PORT = process.env.PORT || 3002
const CLAIM_WINDOW_MS = 10 * 60 * 1000

// Small per-IP limiter: claims and lookups are cheap, but the registry is
// public and shouldn't be scriptable at scale.
function rateLimit({ windowMs, max }) {
  const hits = new Map()
  return (req, res, next) => {
    const now = Date.now()
    if (hits.size > 5000) for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k)
    const key = req.ip || 'unknown'
    const e = hits.get(key)
    if (!e || now > e.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs })
      return next()
    }
    if (e.count >= max) return res.status(429).json({ error: 'rate_limited' })
    e.count += 1
    return next()
  }
}
app.use('/api/claim', rateLimit({ windowMs: 60000, max: 10 }))
app.use('/api', rateLimit({ windowMs: 60000, max: 240 }))

// The exact text the wallet is asked to sign. Includes the address and a
// timestamp, so a signature can't be replayed for another tag or later.
function claimMessage(tag, address, at) {
  return `Claim @${tag} on Nimtag\nAddress: ${address}\nTime: ${at}`
}

app.get('/api/tags/:tag', (req, res) => {
  const tag = names.normalise(req.params.tag)
  if (names.validate(tag)) return res.status(400).json({ error: 'invalid' })
  const entry = names.lookup(tag)
  if (!entry) return res.status(404).json({ error: 'not_found' })
  res.json({ tag, address: entry.address, since: entry.since })
})

app.get('/api/address/:address', (req, res) => {
  if (!isAddress(req.params.address)) return res.status(400).json({ error: 'bad_address' })
  const address = canonical(req.params.address)
  const tag = names.tagFor(address)
  res.json({ address, tag })
})

// Is this tag free? For the claim screen's live check.
app.get('/api/check/:tag', (req, res) => {
  const tag = names.normalise(req.params.tag)
  const problem = names.validate(tag)
  if (problem) return res.json({ tag, ok: false, reason: problem })
  res.json({ tag, ok: !names.lookup(tag), reason: names.lookup(tag) ? 'Already taken.' : null })
})

app.post('/api/claim', (req, res) => {
  const { tag: rawTag, address: rawAddress, at, publicKey, signature } = req.body || {}
  const tag = names.normalise(rawTag)
  const problem = names.validate(tag)
  if (problem) return res.status(400).json({ error: 'invalid', message: problem })
  if (!isAddress(rawAddress)) return res.status(400).json({ error: 'bad_address' })
  const address = canonical(rawAddress)
  const t = Date.parse(at)
  if (!Number.isFinite(t) || Math.abs(Date.now() - t) > CLAIM_WINDOW_MS) {
    return res.status(400).json({ error: 'stale', message: 'Signature expired — try again.' })
  }
  const proven = recoverAddress({ message: claimMessage(tag, address, at), publicKey, signature })
  if (!proven || proven !== address) {
    return res.status(401).json({ error: 'bad_signature', message: 'Signature does not match this wallet.' })
  }
  const result = names.claim(tag, address)
  if (result.error === 'taken') return res.status(409).json({ error: 'taken', message: 'Already taken.' })
  res.json({ ok: true, tag, address })
})

app.get('/api/stats', (req, res) => {
  res.json({ tags: names.count() })
})

// Built app, with SPA fallback so /@tag deep links load the page.
const dist = path.join(__dirname, '..', '..', 'app', 'dist')
app.use(express.static(dist))
app.use((req, res) => res.sendFile(path.join(dist, 'index.html')))

app.listen(PORT, () => console.log(`Nimtag listening on ${PORT}`))

module.exports = { claimMessage }
