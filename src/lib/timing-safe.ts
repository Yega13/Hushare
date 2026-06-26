// Pure Web Crypto XOR — works on both Node.js and Cloudflare Workers edge runtime.
// No node:crypto import needed. Both inputs are UTF-8 encoded and compared byte-by-byte.
// Branch-free length equalisation: XOR the lengths into r so unequal lengths always
// produce r !== 0, without an early return that leaks the expected length via timing.
export function timingSafeEqual(a: string, b: string): boolean {
  const ae = new TextEncoder().encode(a)
  const be = new TextEncoder().encode(b)
  const len = Math.max(ae.length, be.length)
  let r = ae.length ^ be.length  // non-zero when lengths differ
  for (let i = 0; i < len; i++) r |= (ae[i] ?? 0) ^ (be[i] ?? 0)
  return r === 0
}
