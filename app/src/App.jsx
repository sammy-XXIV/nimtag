import { useEffect, useMemo, useState } from 'react'
import './App.css'
import Identicon from './Identicon'
import { api, claimMessage } from './api'
import { getAddress, insideNimiqPay, sendNim, shortAddress, signClaim } from './wallet'

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

function ClaimCard({ address, tag, onClaimed }) {
  const [input, setInput] = useState('')
  const [check, setCheck] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
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
    <>
      {tag ? (
        <NameCard
          tag={tag}
          address={address}
          link={link}
          onCopy={() => {
            navigator.clipboard?.writeText(link)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
          sub={copied ? 'LINK COPIED' : 'YOUR NAME'}
        />
      ) : (
        <div className="card">
          <div className="me">
            <Identicon address={address} size={52} />
            <div className="me-text">
              <span className="label">Your wallet</span>
              <span className="addr">{shortAddress(address)}</span>
            </div>
          </div>
        </div>
      )}

      <section className="card">
        <span className="label">{tag ? 'Change your name' : 'Claim your name'}</span>
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
        <p className="hint">Free. Your wallet signs a message to prove it's yours — nothing is sent.</p>
      </section>
    </>
  )
}

// ---------- send NIM to a tag ----------

function SendCard({ myTag, initialTag = '' }) {
  const [input, setInput] = useState(initialTag)
  const [target, setTarget] = useState(null)
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
          {done.nim.toLocaleString()} NIM → <span className="tag">@{done.tag}</span>
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
      {error && <p className="check check--bad">{error}</p>}
      <button type="button" className="cta" disabled={!canSend} onClick={send}>
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
          <a className="cta" href={`${OPEN_LINK}/@${entry.tag}`}>Open in Nimiq Pay to send</a>
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
  const sendTo = useMemo(() => (new URLSearchParams(window.location.search).get('to') || '').toLowerCase(), [])
  const [address, setAddress] = useState(null)
  const [myTag, setMyTag] = useState(null)
  const [stats, setStats] = useState(null)

  useEffect(() => {
    api.stats().then(setStats).catch(() => {})
    // ?preview renders the in-wallet screens with a sample address, for
    // looking at the UI in a normal browser. Claiming/sending still needs the wallet.
    const preview = new URLSearchParams(window.location.search).has('preview')
    getAddress().then(async (found) => {
      const a = found || (preview ? SAMPLE_ADDRESS : null)
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
          <Profile tag={route.profile} inside={inside && Boolean(address)} onSend={(t) => { window.location.href = `/?to=${t}` }} />
        </>
      ) : (
        <>
          <div className="header">
            <p className="eyebrow">Nimiq Pay mini app</p>
            <h1 className="hero">
              Send NIM to a <span className="tag">@name</span>,<br />not an address.
            </h1>
            <p className="subtitle">
              Claim your name once. From then on, anyone with Nimiq Pay can pay you by typing it.
            </p>
          </div>

          {address ? (
            <>
              <ClaimCard address={address} tag={myTag} onClaimed={setMyTag} />
              <SendCard myTag={myTag} initialTag={sendTo} />
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
