// IS THIS FAILURE THE NETWORK, OR THE SERVER'S ANSWER?
//
// A fetch that never reaches the server rejects with a TypeError; one the browser gave up on
// (AbortSignal.timeout) rejects with a DOMException named TimeoutError -- which IS an instanceof
// Error, so an `e instanceof Error ? e.message : t('common.networkError')` branch never reached
// the translated message and showed the engine's own English text, different per browser, to
// Armenian and Russian owners. The server's refusals arrive as a response body, never here.

export function isNetworkFailure(e: unknown): boolean {
  if (e instanceof TypeError) return true
  return typeof e === 'object' && e !== null && 'name' in e && (e as { name?: unknown }).name === 'TimeoutError'
}
