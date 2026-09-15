import { useEffect, useMemo, useState } from 'react'
import './App.css'
import Identicon from './Identicon'
import { api, claimMessage } from './api'
import { getAddress, insideNimiqPay, sendNim, shortAddress, signClaim } from './wallet'

const OPEN_LINK = `https://nimpay.app/miniapps/open/${window.location.host}`

function useDebounced(value, ms) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

// ---------- your tag: show it, or claim one ----------

function ClaimCard({ address, tag, onClaimed }) {
  const [input, setInput] = useState('')
  const [check, setCheck] = useState(null) // { ok, reason }
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

  const link = tag ? `${window.location.origin}/@${tag}` : null

  return (
    <section className="card">
      <div className="me">
        <Identicon address={address} size={56} />
        <div className="me-text">
          {tag ? (
            <>
              <span className="tag tag--big">@{tag}</span>
              <span className="addr">{shortAddress(address)}</span>
            </>
          ) : (
            <>
              <span className="label">Your wallet</span>
              <span className="addr">{shortAddress(address)}</span>
            </>
          )}
        </div>
      </div>

      {tag && (
        <div className="share">
          <span className="label">Your link</span>
          <button type="button" className="copy" onClick={() => navigator.clipboard?.writeText(link)}>
            {link.replace(/^https?:\/\//, '')} <span>copy</span>
          </button>
          <p className="hint">Anyone with Nimiq Pay can open it and send you NIM by name.</p>
        </div>
      )}

      <div className="claim">
        <span className="label">{tag ? 'Change it' : 'Claim your @tag'}</span>
        <div className="claim-row">
          <span className="at">@</span>
          <input
            className="claim-input"
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
        <button type="button" className="primary" disabled={!wanted || !check?.ok || busy} onClick={claim}>
          {busy ? 'Waiting for your signature…' : `Claim @${wanted || '…'}`}
        </button>
        <p className="hint">Free. Your wallet signs a message to prove it's yours — nothing is sent.</p>
      </div>
    </section>
  )
}

// ---------- send NIM to a tag ----------

function SendCard({ myTag, initialTag = '' }) {
  const [input, setInput] = useState(initialTag)
  const [target, setTarget] = useState(null) // { tag, address } | { missing }
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [error, setError] = useState('')
  const wanted = useDebounced(input.trim().replace(/^@/, '').toLowerCase(), 300)

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
  const canSend = target?.address && nim > 0 && !busy

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
          <strong>{done.nim.toLocaleString()} NIM</strong> to <span className="tag">@{done.tag}</span>
        </p>
        <span className="addr">tx {String(done.hash).slice(0, 12)}…</span>
        <button type="button" className="secondary" onClick={() => { setDone(null); setAmount(''); setInput('') }}>
          Send another
        </button>
      </section>
    )
  }

  return (
    <section className="card">
      <span className="label">Send NIM to</span>
      <div className="claim-row">
        <span className="at">@</span>
        <input
          className="claim-input"
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
          <Identicon address={target.address} size={48} />
          <div className="me-text">
            <span className="tag">@{target.tag}</span>
            <span className="addr">{shortAddress(target.address)}</span>
          </div>
        </div>
      )}
      {target?.missing && <p className="check check--bad">Nobody has claimed @{target.missing} yet.</p>}

      <div className="amount-row">
        <input
          className="amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
          placeholder="0"
          disabled={!target?.address}
        />
        <span className="unit">NIM</span>
      </div>
      {error && <p className="check check--bad">{error}</p>}
      <button type="button" className="primary" disabled={!canSend} onClick={send}>
        {busy ? 'Confirm in Nimiq Pay…' : target?.tag ? `Send to @${target.tag}` : 'Send'}
      </button>
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
        <a className="secondary" href="/">Claim it</a>
      </section>
    )
  }
  if (!entry) return <section className="card"><span className="label">Looking up @{tag}…</span></section>
  return (
    <section className="card">
      <div className="me">
        <Identicon address={entry.address} size={72} />
        <div className="me-text">
          <span className="tag tag--big">@{entry.tag}</span>
          <span className="addr">{entry.address}</span>
        </div>
      </div>
      {inside ? (
        <button type="button" className="primary" onClick={() => onSend(entry.tag)}>Send NIM to @{entry.tag}</button>
      ) : (
        <a className="primary" href={`${OPEN_LINK}/@${entry.tag}`}>Open in Nimiq Pay to send</a>
      )}
    </section>
  )
}

// ---------- app ----------

function App() {
  const inside = insideNimiqPay()
  const route = useMemo(() => {
    const m = window.location.pathname.match(/^\/@([a-z0-9_]{3,20})$/i)
    return m ? { profile: m[1].toLowerCase() } : {}
  }, [])
  const [address, setAddress] = useState(null)
  const [myTag, setMyTag] = useState(null)
  const [stats, setStats] = useState(null)
  // /?to=name preselects the recipient (how a profile page hands off to Send).
  const sendTo = useMemo(() => (new URLSearchParams(window.location.search).get('to') || '').toLowerCase(), [])

  useEffect(() => {
    api.stats().then(setStats).catch(() => {})
    getAddress().then(async (a) => {
      if (!a) return
      setAddress(a)
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
        <a className="wordmark" href="/">nimtag</a>
        {stats && stats.tags > 0 && (
          <span className="count">{stats.tags.toLocaleString()} {stats.tags === 1 ? 'name' : 'names'} claimed</span>
        )}
      </header>

      {route.profile ? (
        <Profile tag={route.profile} inside={inside && Boolean(address)} onSend={(t) => { window.location.href = `/?to=${t}` }} />
      ) : (
        <>
          <h1 className="hero">
            Send NIM to a <span className="tag">@name</span>,<br />not an address.
          </h1>

          {address ? (
            <>
              <ClaimCard address={address} tag={myTag} onClaimed={setMyTag} />
              <SendCard myTag={myTag} initialTag={sendTo} />
            </>
          ) : inside ? (
            <section className="card"><span className="label">Connecting to your wallet…</span></section>
          ) : (
            <section className="card">
              <p className="hint">Nimtag lives inside Nimiq Pay. Open it there to claim your name and send NIM by name.</p>
              <a className="primary" href={OPEN_LINK}>Open in Nimiq Pay</a>
            </section>
          )}
        </>
      )}

      <footer className="foot">
        <span>Free · no fees · your wallet stays yours</span>
        <a href="https://github.com/sammy-XXIV/nimtag" target="_blank" rel="noreferrer">source</a>
      </footer>
    </div>
  )
}

export default App
