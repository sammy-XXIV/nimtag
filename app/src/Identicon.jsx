import { useEffect, useState } from 'react'
import Identicons from '@nimiq/identicons/dist/identicons.min.js'

Identicons.svgPath = '/identicons.min.svg'

// Nimiq's own identicon for an address — the thing people already recognise
// their wallet by, so a resolved @tag is visibly the right person.
function Identicon({ address, size = 64 }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    let stopped = false
    if (!address) return undefined
    Identicons.toDataUrl(address)
      .then((url) => {
        if (!stopped) setSrc(url)
      })
      .catch(() => {})
    return () => {
      stopped = true
    }
  }, [address])
  return (
    <span className="identicon" style={{ width: size, height: size }} aria-hidden="true">
      {src && <img src={src} alt="" width={size} height={size} />}
    </span>
  )
}

export default Identicon
