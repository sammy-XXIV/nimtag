import { init, getHostLanguage } from '@nimiq/mini-app-sdk'

const NIM_TO_LUNA = 100000

// Dev mode: outside Nimiq Pay on a dev build, stand in for the wallet so the
// whole flow can be clicked through locally. The server accepts the mock
// signature only when started with DEV_MODE=true.
export const MOCK_WALLET = import.meta.env.DEV && !(typeof window !== 'undefined' && (window.nimiqPay || window.nimiq))
const MOCK_ADDRESS = 'NQ48 VUP6 42E2 X803 TQAU LX1V 1UJV LUBF RUX7'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// init() resolves only once Nimiq Pay has injected its provider; outside the
// wallet it would hang, so a timeout turns that into a clear state instead.
let nimiqPromise = null
export function getNimiq() {
  if (!nimiqPromise) {
    nimiqPromise = Promise.race([
      init(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('NOT_IN_NIMIQ_PAY')), 4000)),
    ]).catch((err) => {
      nimiqPromise = null
      throw err
    })
  }
  return nimiqPromise
}

export function insideNimiqPay() {
  return MOCK_WALLET || (typeof window !== 'undefined' && Boolean(window.nimiqPay || window.nimiq))
}

let accountPromise = null
export function getAddress() {
  if (MOCK_WALLET) return Promise.resolve(MOCK_ADDRESS)
  if (!accountPromise) {
    accountPromise = getNimiq()
      .then((n) => n.listAccounts())
      .then((r) => (Array.isArray(r) && r[0]) || null)
      .catch(() => {
        accountPromise = null
        return null
      })
  }
  return accountPromise
}

function unwrap(result, fallback) {
  if (result && typeof result === 'object' && result.error) {
    const e = new Error(result.error.message || fallback)
    e.type = result.error.type
    throw e
  }
  return result
}

// The wallet signs the claim text; the server checks the signature matches
// the address before it will register the tag.
export async function signClaim(message) {
  if (MOCK_WALLET) {
    await wait(600)
    return { publicKey: 'dev', signature: 'dev', message }
  }
  const n = await getNimiq()
  return unwrap(await n.sign(message), 'sign_failed')
}

export async function sendNim({ recipient, amountNim, memo }) {
  if (MOCK_WALLET) {
    await wait(900)
    return 'dev' + Math.random().toString(16).slice(2).padEnd(60, '0')
  }
  const n = await getNimiq()
  const value = Math.round(amountNim * NIM_TO_LUNA)
  const result = memo
    ? await n.sendBasicTransactionWithData({ recipient, value, data: memo })
    : await n.sendBasicTransaction({ recipient, value })
  return unwrap(result, 'send_failed')
}

// Wallet's language for number/date formatting; browser's outside Nimiq Pay.
export function locale() {
  return getHostLanguage() || (typeof navigator !== 'undefined' ? navigator.language : 'en')
}

export function fmtNim(n) {
  return Number(n).toLocaleString(locale(), { maximumFractionDigits: 2 })
}

export function shortAddress(a) {
  const p = String(a || '').split(' ')
  return p.length >= 3 ? `${p[0]} ${p[1]} … ${p[p.length - 1]}` : a
}
