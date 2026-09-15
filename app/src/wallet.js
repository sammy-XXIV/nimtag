import { init } from '@nimiq/mini-app-sdk'

const NIM_TO_LUNA = 100000

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
  return typeof window !== 'undefined' && Boolean(window.nimiqPay || window.nimiq)
}

let accountPromise = null
export function getAddress() {
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
  const n = await getNimiq()
  return unwrap(await n.sign(message), 'sign_failed')
}

export async function sendNim({ recipient, amountNim, memo }) {
  const n = await getNimiq()
  const value = Math.round(amountNim * NIM_TO_LUNA)
  const result = memo
    ? await n.sendBasicTransactionWithData({ recipient, value, data: memo })
    : await n.sendBasicTransaction({ recipient, value })
  return unwrap(result, 'send_failed')
}

export function shortAddress(a) {
  const p = String(a || '').split(' ')
  return p.length >= 3 ? `${p[0]} ${p[1]} … ${p[p.length - 1]}` : a
}
