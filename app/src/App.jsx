import { useEffect, useMemo, useState } from 'react'
import './App.css'
import Identicon from './Identicon'
import { api, claimMessage } from './api'
import { fmtNim, getAddress, insideNimiqPay, locale, sendNim, shortAddress, signClaim } from './wallet'

const OPEN_LINK = `https://nimpay.app/miniapps/open/${window.location.host}`
const SAMPLE_ADDRESS = 'NQ48 VUP6 42E2 X803 TQAU LX1V 1UJV LUBF RUX7'

function useDebounced(value, ms) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

// The printed pass for a name: identicon, @tag, address. Cream paper — the
// "real thing" side of the design, same as Kindo's receipts.
function NameCard({ tag, address, link, onCopy, sub = 'NIMTAG · NAME' }) {
  return (
    <div className="namecard">
      <div className="namecard-top">
        <span className="namecard-brand">NIMTAG</span>
        <span className="namecard-sub">{sub}</span>
      </div>
      <div className="namecard-body">
        <Identicon address={address} size={64} />
        <div className="namecard-text">
          <span className="namecard-tag">{tag}</span>
          <span className="namecard-addr">{address}</span>
        </div>
      </div>
      {link && (
        <div className="namecard-foot">
          <span>{link.replace(/^https?:\/\//, '')}</span>
          <button type="button" className="namecard-copy" onClick={onCopy}>copy</button>
        </div>
      )}
    </div>
  )
}

// ---------- your tag: show it, or claim one ----------

function ClaimCard({ address, onClaimed }) {
  const [input, setInput] = useState('')
  const [check, setCheck] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const wanted = useDebounced(input.trim().replace(/^@/, '').toLowerCase(), 300)

  useEffect(() => {
    if (!wanted) return setCheck(null)
    let stopped = false
    api.check(wanted).then((c) => !stopped && setCheck(c)).catch(() => {})
    return () => {
      stopped = true
    }
  }, [wanted])

  async function claim() {
    setBusy(true)
    setError('')
    try {
      const at = new Date().toISOString()
      const { publicKey, signature } = await signClaim(claimMessage(wanted, address, at))
      await api.claim({ tag: wanted, address, at, publicKey, signature })
      onClaimed(wanted)
      setInput('')
    } catch (e) {
      setError(e.type === 'PermissionDeniedError' ? 'Cancelled.' : e.message || 'Could not claim.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section className="card">
        <div className="me">
          <Identicon address={address} size={44} />
          <div className="me-text">
            <span className="label">This wallet</span>
            <span className="addr">{shortAddress(address)}</span>
          </div>
        </div>
        <span className="label">Pick your name</span>
        <div className="field-row">
          <span className="at">@</span>
          <input
            className="field-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="yourname"
            maxLength={21}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
        {wanted && check && (
          <p className={`check ${check.ok ? 'check--ok' : 'check--bad'}`}>
            {check.ok ? `@${wanted} is free` : check.reason}
          </p>
        )}
        {error && <p className="check check--bad">{error}</p>}
        <button type="button" className="cta" disabled={!wanted || !check?.ok || busy} onClick={claim}>
          {busy ? 'Waiting for your signature…' : `Claim @${wanted || '…'}`}
        </button>
        <p className="hint">Free, and permanent — one name per wallet, no changing it later. Your wallet signs a message to prove it's yours; nothing is sent.</p>
      </section>
    </>
  )
}

// ---------- send NIM to a tag ----------

function SendCard({ myTag, initialTag = '', initialAmount = '', balance, onSent }) {
  const [input, setInput] = useState(initialTag)
  const [target, setTarget] = useState(null)
  const [amount, setAmount] = useState(initialAmount)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [error, setError] = useState('')
  const wanted = useDebounced(input.trim().replace(/^@/, '').toLowerCase(), 300)

  useEffect(() => {
    setInput(initialTag)
  }, [initialTag])

  useEffect(() => {
    if (!wanted) return setTarget(null)
    let stopped = false
    api
      .lookup(wanted)
      .then((t) => !stopped && setTarget(t))
      .catch(() => !stopped && setTarget({ missing: wanted }))
    return () => {
      stopped = true
    }
  }, [wanted])

  const nim = parseFloat(amount)
  const short = balance != null && nim > balance
  const canSend = target?.address && nim > 0 && !short && !busy

  async function send() {
    setBusy(true)
    setError('')
    try {
      const hash = await sendNim({
        recipient: target.address,
        amountNim: nim,
        memo: myTag ? `@${myTag} → @${target.tag}` : `→ @${target.tag}`,
      })
      setDone({ hash, tag: target.tag, nim })
      onSent?.()
    } catch (e) {
      setError(e.type === 'PermissionDeniedError' ? 'Cancelled.' : e.message || 'Send failed.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <section className="card card--done">
        <span className="label">Sent</span>
        <p className="done-line">
          {fmtNim(done.nim)} NIM → <span className="tag">@{done.tag}</span>
        </p>
        <span className="addr">tx {String(done.hash).slice(0, 14)}…</span>
        <button type="button" className="text-button" onClick={() => { setDone(null); setAmount(''); setInput('') }}>
          Send another &rarr;
        </button>
      </section>
    )
  }

  return (
    <section className="card">
      <span className="label">Send NIM to a name</span>
      <div className="field-row">
        <span className="at">@</span>
        <input
          className="field-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="theirname"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>

      {target?.address && (
        <div className="me me--target">
          <Identicon address={target.address} size={44} />
          <div className="me-text">
            <span className="tag">@{target.tag}</span>
            <span className="addr">{shortAddress(target.address)}</span>
          </div>
        </div>
      )}
      {target?.missing && <p className="check check--bad">Nobody has claimed @{target.missing} yet.</p>}

      <div className="field-row">
        <input
          className="field-input amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
          placeholder="0"
          disabled={!target?.address}
        />
        <span className="unit">NIM</span>
      </div>
      {balance != null && (
        <p className={`check ${short ? 'check--bad' : ''}`}>
          {short
            ? `That's ${fmtNim(nim - balance)} NIM more than you have.`
            : `Balance ${fmtNim(balance)} NIM`}
        </p>
      )}
      {error && <p className="check check--bad">{error}</p>}
      <button type="button" className="cta" disabled={!canSend} onClick={send}>
        {busy ? 'Confirm in Nimiq Pay…' : target?.tag ? `Send to @${target.tag}` : 'Send'}
      </button>
    </section>
  )
}

// ---------- people: who you've paid, by name ----------
// The chain is the source (every send carries "@you → @them" as its memo),
// but it's shown as people, not a ledger — Nimiq Pay already has the ledger.

function timeAgo(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(ts).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })
}

function People({ address, refreshKey, onPick }) {
  const [items, setItems] = useState(null)
  useEffect(() => {
    let stopped = false
    api.activity(address).then((a) => !stopped && setItems(a.items)).catch(() => !stopped && setItems([]))
    return () => {
      stopped = true
    }
  }, [address, refreshKey])

  if (!items) return null
  // Latest interaction per counterparty; named ones up top, unnamed folded.
  const seen = new Map()
  for (const t of items) if (!seen.has(t.address)) seen.set(t.address, t)
  const named = [...seen.values()].filter((t) => t.tag)
  const unnamed = seen.size - named.length
  if (!named.length && !unnamed) return null

  return (
    <section className="card">
      <span className="label">People</span>
      {named.length > 0 && (
        <ul className="feed">
          {named.slice(0, 10).map((t) => (
            <li className="feed-row" key={t.address}>
              <Identicon address={t.address} size={36} />
              <button type="button" className="feed-text" onClick={() => onPick(t.tag)}>
                <span className="feed-line"><span className="tag">@{t.tag}</span></span>
                <span className="feed-meta">
                  {t.direction === 'in' ? 'sent you' : 'you sent'} {fmtNim(t.nim)} NIM · {timeAgo(t.at)}
                </span>
              </button>
              <span className="feed-go" aria-hidden="true">&rarr;</span>
            </li>
          ))}
        </ul>
      )}
      {unnamed > 0 && (
        <p className="hint">
          {named.length ? 'Plus ' : ''}{unnamed} {unnamed === 1 ? 'address' : 'addresses'} without a name yet — send them your link.
        </p>
      )}
    </section>
  )
}

// ---------- directory: who's here ----------

function Directory({ me, onPick }) {
  const [list, setList] = useState([])
  useEffect(() => {
    api.directory().then((d) => setList(d.names.filter((n) => n.tag !== me))).catch(() => {})
  }, [me])
  if (!list.length) return null
  return (
    <section className="card">
      <span className="label">People on Nimtag</span>
      <div className="chips">
        {list.slice(0, 16).map((n) => (
          <button type="button" className="chip" key={n.tag} onClick={() => onPick(n.tag)}>
            <Identicon address={n.address} size={22} />
            <span>@{n.tag}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

// ---------- request: a link that opens Send pre-filled ----------

function RequestCard({ tag }) {
  const [amount, setAmount] = useState('')
  const [copied, setCopied] = useState(false)
  const nim = parseFloat(amount)
  const link = `${window.location.origin}/@${tag}${nim > 0 ? `?amount=${nim}` : ''}`
  return (
    <section className="card">
      <span className="label">Request NIM</span>
      <div className="field-row">
        <input
          className="field-input amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
          placeholder="0"
        />
        <span className="unit">NIM</span>
      </div>
      <button
        type="button"
        className="cta"
        onClick={() => {
          navigator.clipboard?.writeText(link)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? 'Link copied' : nim > 0 ? `Copy link for ${fmtNim(nim)} NIM` : 'Copy your link'}
      </button>
      <p className="hint">Paste it anywhere. It opens in Nimiq Pay with Send already filled in.</p>
    </section>
  )
}

// ---------- /@tag: a public page for one name ----------

function Profile({ tag, inside, onSend }) {
  const [entry, setEntry] = useState(null)
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    api.lookup(tag).then(setEntry).catch(() => setMissing(true))
  }, [tag])

  if (missing) {
    return (
      <section className="card">
        <p className="check check--bad">@{tag} hasn't been claimed.</p>
        <a className="cta" href="/">Claim it</a>
      </section>
    )
  }
  if (!entry) return <section className="card"><span className="label">Looking up @{tag}…</span></section>
  return (
    <>
      <NameCard tag={entry.tag} address={entry.address} sub="NIMTAG · NAME" />
      <div className="card">
        {inside ? (
          <button type="button" className="cta" onClick={() => onSend(entry.tag)}>Send NIM to @{entry.tag}</button>
        ) : (
          <a className="cta" href={`${OPEN_LINK}/@${entry.tag}${window.location.search}`}>Open in Nimiq Pay to send</a>
        )}
      </div>
    </>
  )
}

// ---------- app ----------

function App() {
  const inside = insideNimiqPay()
  const route = useMemo(() => {
    const m = window.location.pathname.match(/^\/@([a-z0-9_]{3,20})$/i)
    return m ? { profile: m[1].toLowerCase() } : {}
  }, [])
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const [sendTo, setSendTo] = useState((params.get('to') || '').toLowerCase())
  const sendAmount = params.get('amount') || ''
  const [refreshKey, setRefreshKey] = useState(0)
  const [address, setAddress] = useState(null)
  const [myTag, setMyTag] = useState(null)
  const [stats, setStats] = useState(null)
  const [copied, setCopied] = useState(false)
  const [balance, setBalance] = useState(null)

  // Refresh the balance whenever the wallet is known and after a send.
  function refreshBalance(a) {
    if (!a) return
    api.balance(a).then((b) => setBalance(b.nim)).catch(() => {})
  }

  function copyLink() {
    navigator.clipboard?.writeText(`${window.location.origin}/@${myTag}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  useEffect(() => {
    api.stats().then(setStats).catch(() => {})
    getAddress().then(async (a) => {
      if (!a) return
      setAddress(a)
      refreshBalance(a)
      try {
        const { tag } = await api.tagFor(a)
        setMyTag(tag)
      } catch {
        /* no tag yet */
      }
    })
  }, [])

  return (
    <div className="page">
      <header className="top">
        <a className="wordmark" href="/">Nimtag</a>
        {stats && stats.tags > 0 && (
          <span className="count">{stats.tags.toLocaleString()} {stats.tags === 1 ? 'name' : 'names'} claimed</span>
        )}
      </header>

      {route.profile ? (
        <>
          <div className="header">
            <p className="eyebrow">Nimtag · @{route.profile}</p>
            <h1 className="hero">Send NIM to <span className="tag">@{route.profile}</span>.</h1>
          </div>
          <Profile tag={route.profile} inside={inside && Boolean(address)} onSend={(t) => { window.location.href = `/?to=${t}${sendAmount ? `&amount=${sendAmount}` : ''}` }} />
        </>
      ) : (
        <>
          <div className="header">
            <p className="eyebrow">{address && myTag ? `Nimtag · @${myTag}` : 'Nimiq Pay mini app'}</p>
            {address && myTag ? (
              <h1 className="hero">Send NIM to a <span className="tag">@name</span>.</h1>
            ) : (
              <h1 className="hero">
                Send NIM to a <span className="tag">@name</span>,<br />not an address.
              </h1>
            )}
            {!myTag && (
              <p className="subtitle">
                {address
                  ? 'First, claim yours. It takes ten seconds and costs nothing — your wallet just signs to prove it’s you.'
                  : 'Claim your name once. From then on, anyone with Nimiq Pay can pay you by typing it.'}
              </p>
            )}
          </div>

          {address && !myTag ? (
            <ClaimCard address={address} onClaimed={setMyTag} />
          ) : address ? (
            <>
              <NameCard tag={myTag} address={address} link={`${window.location.origin}/@${myTag}`} onCopy={copyLink} sub={copied ? 'LINK COPIED' : 'YOUR NAME'} />
              <SendCard
                myTag={myTag}
                initialTag={sendTo}
                initialAmount={sendAmount}
                balance={balance}
                onSent={() => {
                  refreshBalance(address)
                  setRefreshKey((k) => k + 1)
                }}
              />
              <People address={address} refreshKey={refreshKey} onPick={setSendTo} />
              <Directory me={myTag} onPick={setSendTo} />
              <RequestCard tag={myTag} />
            </>
          ) : inside ? (
            <section className="card"><span className="label">Connecting to your wallet…</span></section>
          ) : (
            <>
              <NameCard tag="adam" address={SAMPLE_ADDRESS} sub="EXAMPLE" />
              <div className="card">
                <p className="hint">Nimtag lives inside Nimiq Pay. Open it there to claim your name and send NIM by name.</p>
                <a className="cta" href={OPEN_LINK}>Open in Nimiq Pay</a>
              </div>
            </>
          )}
        </>
      )}

      <footer className="foot">
        <span>Free · no fees · your keys stay yours</span>
        <a href="https://github.com/sammy-XXIV/nimtag" target="_blank" rel="noreferrer">source</a>
      </footer>
    </div>
  )
}

export default App
