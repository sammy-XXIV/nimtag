const fs = require('fs')
const path = require('path')

// Name registry: @tag -> Nimiq address. One tag per address; re-claiming
// from the same address moves it. File-backed on the Railway volume.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..')
const FILE = path.join(DATA_DIR, 'names.json')

const RULES = /^[a-z][a-z0-9_]{2,19}$/
const RESERVED = new Set([
  'nimiq', 'nimiqpay', 'nimtag', 'admin', 'root', 'support', 'help', 'team', 'official',
  'wallet', 'pay', 'nim', 'null', 'undefined', 'api', 'www', 'me', 'you', 'send', 'claim',
])

function normalise(raw) {
  return String(raw || '').trim().replace(/^@/, '').toLowerCase()
}

function validate(tag) {
  if (!RULES.test(tag)) return 'Use 3–20 characters: letters, numbers, underscores; start with a letter.'
  if (RESERVED.has(tag)) return 'That one is reserved.'
  return null
}

function readAll() {
  if (!fs.existsSync(FILE)) return { byTag: {}, byAddress: {} }
  return JSON.parse(fs.readFileSync(FILE, 'utf8'))
}

function writeAll(db) {
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2))
}

function lookup(tag) {
  const db = readAll()
  return Object.hasOwn(db.byTag, tag) ? db.byTag[tag] : null
}

function tagFor(address) {
  const db = readAll()
  return Object.hasOwn(db.byAddress, address) ? db.byAddress[address] : null
}

// Claims `tag` for `address`. Returns { ok } or { error }. A tag someone
// else holds is taken. A wallet gets exactly one name, for good: once
// claimed it can't be changed or released, so a name always means the same
// wallet.
function claim(tag, address) {
  const db = readAll()
  const holder = Object.hasOwn(db.byTag, tag) ? db.byTag[tag] : null
  if (holder && holder.address !== address) return { error: 'taken' }
  const existing = Object.hasOwn(db.byAddress, address) ? db.byAddress[address] : null
  if (existing && existing !== tag) return { error: 'already_named', tag: existing }
  if (existing === tag) return { ok: true }
  db.byTag[tag] = { address, since: Date.now() }
  db.byAddress[address] = tag
  writeAll(db)
  return { ok: true }
}

function count() {
  return Object.keys(readAll().byTag).length
}

function recent(limit = 30) {
  const db = readAll()
  return Object.entries(db.byTag)
    .map(([tag, e]) => ({ tag, address: e.address, since: e.since }))
    .sort((a, b) => b.since - a.since)
    .slice(0, limit)
}

module.exports = { normalise, validate, lookup, tagFor, claim, count, recent }
