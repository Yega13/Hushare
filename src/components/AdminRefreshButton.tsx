'use client'

// A genuine browser tab reload (like pressing F5) — re-runs the dynamic admin page server-side
// for fresh data. Not a Next.js soft-nav (which wouldn't refetch) and not a hard cache-bypass;
// a normal reload using the cache, exactly what "refresh the tab" means.
export default function AdminRefreshButton() {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      style={{ color: '#630826', fontWeight: 600, fontSize: 13, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
    >
      Refresh
    </button>
  )
}
