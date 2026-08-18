export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// timeZone is pinned deliberately. Without it this reads the runtime's zone, and the two runtimes
// disagree: the Worker renders in UTC, the browser in the visitor's local zone. For an album made
// at 23:18 UTC that is "August 17" from the server and "August 18" from a browser in Yerevan — two
// different text nodes in the same span, which is a hydration mismatch (React error #418, seen
// twice in production on 2026-08-18 on an album created at 23:18). React then throws away the
// server-rendered subtree and re-renders it, so it also caused a visible flicker on load.
//
// Pinning UTC makes both sides agree by construction rather than by luck. A creation date is not a
// clock — being consistent matters more than being accurate to the hour, and UTC is what the
// database actually stores. The same hazard is handled the other way in RevealCountdown, which
// defers formatting to the client because a countdown genuinely must be local.
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
