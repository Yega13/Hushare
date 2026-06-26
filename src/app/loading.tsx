export default function Loading() {
  return (
    <div className="hush-route-loading" role="status" aria-live="polite">
      <span className="hush-route-loading-dot" />
      <span className="sr-only">Loading</span>
    </div>
  )
}
