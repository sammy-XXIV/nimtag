const path = require('path')
const express = require('express')
const names = require('./names')
const { recoverAddress, isAddress, canonical } = require('./verify')

const app = express()
// Behind Railway's edge the client is the leftmost X-Forwarded-For hop;
// trusting only one hop made every request look like a different IP and the
// limiter never fired.
app.set('trust proxy', true)
app.use(express.json({ limit: '16kb' }))

const PORT = process.env.PORT || 3002
const CLAIM_WINDOW_MS = 10 * 60 * 1000
// A wallet must hold at least this much NIM to claim — every real Nimiq Pay
// user does; a script generating free keypairs to squat names does not.
const MIN_CLAIM_BALANCE_NIM = Number(process.env.MIN_CLAIM_BALANCE_NIM || 1)

// The mock-wallet bypass must never run where real users are.
if (process.env.DEV_MODE === 'true' && process.env.RAILWAY_ENVIRONMENT) {
  console.error('DEV_MODE is set in a Railway environment — refusing to start')
  process.exit(1)
}

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
const RPC_URL = process.env.NIMIQ_RPC_URL || 'https://rpc.nimiqwatch.com'

async function rpc(method, params) {
  const r = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const json = await r.json()
  if (json.error) throw new Error(json.error.message || 'rpc_error')
  return json.result?.data ?? json.result
}

async function balanceNim(address) {
  const account = await rpc('getAccountByAddress', [address])
  return Number(account?.balance || 0) / 100000
}

// Nimiq Pay hands mini apps a receive address and keeps the spendable balance
// on an internal account it tops up from there automatically. So the true
// balance is the receive address plus wherever it forwards to — found from
// the chain: an outgoing transfer that mirrors an incoming one shortly after.
async function linkedAccount(address) {
  const txs = await rpc('getTransactionsByAddress', [address, 30, null])
  const list = (Array.isArray(txs) ? txs : []).slice().sort((a, b) => a.timestamp - b.timestamp)
  let linked = null
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1]
    const t = list[i]
    const sweep = t.from === address && prev.to === address && t.value === prev.value && t.timestamp - prev.timestamp < 30 * 60 * 1000
    if (sweep) linked = t.to // latest one wins
  }
  return linked
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

app.post('/api/claim', async (req, res) => {
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
  // DEV_MODE=true lets the app's mock wallet claim without a real signature.
  // Never set in production.
  const dev = process.env.DEV_MODE === 'true' && publicKey === 'dev' && signature === 'dev'
  const proven = dev ? address : recoverAddress({ message: claimMessage(tag, address, at), publicKey, signature })
  if (!proven) {
    return res.status(401).json({ error: 'bad_signature', message: 'Signature does not match this wallet.' })
  }
  if (proven !== address) {
    // Nimiq Pay signs with whichever account is active in the app, not the
    // one the mini app named. Tell the client which account really signed.
    return res.status(409).json({
      error: 'signer_mismatch',
      signer: proven,
      message: `Nimiq Pay signed with ${proven.slice(0, 9)}…, not this account.`,
    })
  }
  if (!dev) {
    let nim
    try {
      // Receive address plus the account Nimiq Pay forwards it to — the
      // receive address alone is ~0 minutes after anything lands on it.
      const linked = await linkedAccount(address).catch(() => null)
      nim = (await balanceNim(address)) + (linked ? await balanceNim(linked).catch(() => 0) : 0)
    } catch {
      return res.status(502).json({ error: 'chain_unavailable', message: 'Could not check the wallet right now — try again.' })
    }
    if (nim < MIN_CLAIM_BALANCE_NIM) {
      return res.status(403).json({
        error: 'unfunded',
        message: `This wallet needs at least ${MIN_CLAIM_BALANCE_NIM} NIM to claim a name.`,
      })
    }
  }
  const result = names.claim(tag, address)
  if (result.error === 'taken') return res.status(409).json({ error: 'taken', message: 'Already taken.' })
  if (result.error === 'already_named') {
    return res.status(409).json({ error: 'already_named', message: `This wallet is already @${result.tag}. Names are permanent.` })
  }
  res.json({ ok: true, tag, address })
})

// Nimtag sends carry "@from → @to" as the transaction memo, so the chain
// itself is the activity log: read the wallet's recent transactions, decode
// memos, resolve counterparties to names. No server-side history to keep.
function decodeMemo(hex) {
  try {
    const text = Buffer.from(String(hex || ''), 'hex').toString('utf8')
    return /^[ -~ -￿]*$/.test(text) ? text : ''
  } catch {
    return ''
  }
}

const activityCache = new Map()
app.get('/api/activity/:address', async (req, res) => {
  if (!isAddress(req.params.address)) return res.status(400).json({ error: 'bad_address' })
  const address = canonical(req.params.address)
  const hit = activityCache.get(address)
  if (hit && Date.now() - hit.at < 15000) return res.json(hit.value)
  try {
    const txs = await rpc('getTransactionsByAddress', [address, 40, null])
    const items = (Array.isArray(txs) ? txs : []).map((t) => {
      const incoming = t.to === address
      const other = incoming ? t.from : t.to
      return {
        hash: t.hash,
        direction: incoming ? 'in' : 'out',
        address: other,
        tag: names.tagFor(other),
        nim: Number(t.value || 0) / 100000,
        memo: decodeMemo(t.recipientData),
        at: Number(t.timestamp || 0),
      }
    })
    const value = { address, items }
    if (activityCache.size > 500) activityCache.clear()
    activityCache.set(address, { at: Date.now(), value })
    res.json(value)
  } catch (err) {
    res.status(502).json({ error: 'activity_failed', message: err.message })
  }
})

// Recently claimed names, newest first — so early users have someone to send to.
app.get('/api/directory', (req, res) => {
  res.json({ names: names.recent(30) })
})

// Live NIM balance from the Albatross RPC (public node by default).
app.get('/api/balance/:address', async (req, res) => {
  if (!isAddress(req.params.address)) return res.status(400).json({ error: 'bad_address' })
  const address = canonical(req.params.address)
  try {
    const [own, linked] = await Promise.all([balanceNim(address), linkedAccount(address).catch(() => null)])
    const linkedNim = linked ? await balanceNim(linked).catch(() => 0) : 0
    res.json({ address, nim: own + linkedNim, own, linked, linkedNim })
  } catch (err) {
    res.status(502).json({ error: 'balance_failed', message: err.message })
  }
})

// Takedown, guarded by ADMIN_TOKEN (unset = endpoint disabled).
app.delete('/api/tags/:tag', (req, res) => {
  const token = process.env.ADMIN_TOKEN
  if (!token || req.get('x-admin-token') !== token) return res.status(404).json({ error: 'not_found' })
  const tag = names.normalise(req.params.tag)
  res.json({ removed: names.remove(tag), tag })
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
