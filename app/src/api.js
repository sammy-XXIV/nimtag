async function json(res) {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const e = new Error(body.message || body.error || `HTTP ${res.status}`)
    e.code = body.error
    throw e
  }
  return body
}

export const api = {
  check: (tag) => fetch(`/api/check/${encodeURIComponent(tag)}`).then(json),
  lookup: (tag) => fetch(`/api/tags/${encodeURIComponent(tag)}`).then(json),
  tagFor: (address) => fetch(`/api/address/${encodeURIComponent(address)}`).then(json),
  stats: () => fetch('/api/stats').then(json),
  balance: (address) => fetch(`/api/balance/${encodeURIComponent(address)}`).then(json),
  activity: (address) => fetch(`/api/activity/${encodeURIComponent(address)}`).then(json),
  directory: () => fetch('/api/directory').then(json),
  claim: (body) =>
    fetch('/api/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(json),
}

// Must match the server's claimMessage() byte for byte.
export function claimMessage(tag, address, at) {
  return `Claim @${tag} on Nimtag\nAddress: ${address}\nTime: ${at}`
}
