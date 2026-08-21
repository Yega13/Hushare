import type { NextConfig } from "next";
import { execSync } from "node:child_process";

// Stamped into every client error report, so "is this old code?" is a FACT rather than a theory.
//
// It cost a full investigation to learn this the hard way: 91 reports of a bare "Failed to fetch"
// arrived over two days from a message string that no live code path could still produce. Every
// network failure has carried its endpoint since 2026-08-19, and each byte-transfer path throws its
// own distinct text, so the only remaining explanation was a browser running a bundle from before
// that deploy -- and there was no way to confirm it. An unprovable theory is not a diagnosis, so
// the incident was left unfixed rather than guessed at. One field ends that class of ambiguity for
// good: a report either carries the build that is live, or it does not.
//
// The git SHA is the honest identifier (it names the exact code), with a timestamp fallback so a
// build in a tree without git still produces SOMETHING unique instead of throwing and failing the
// whole build. stdio silences git's own stderr on that path.
const BUILD_ID = (() => {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim() || `t${Date.now().toString(36)}`;
  } catch {
    return `t${Date.now().toString(36)}`;
  }
})();

const SUPABASE_HOST = "yqngmyjquwemwogdyuwv.supabase.co";
const R2_ACCOUNT   = "cd64a4cdd390c827e46bff2ff1ab30ed";

// script-src MUST keep 'unsafe-inline': Next.js App Router streams its React hydration payload
// as many inline <script>self.__next_f.push(...)</script> tags whose content is dynamic per
// page — they cannot be hash-allowed, and a nonce would require headers() in the root layout,
// forcing every route out of static rendering. A hash-only script-src was tried (2026-07-10)
// and BLOCKED those framework scripts: React never hydrated and the whole site sat behind the
// preloader forever. Do not remove 'unsafe-inline' unless moving to a full nonce+strict-dynamic
// setup with dynamic rendering accepted.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com https://embed.videodelivery.net",
  "style-src 'self' 'unsafe-inline'",
  [
    "img-src 'self' data: blob:",
    "https://videos.hushare.space",
    "https://videodelivery.net",
    "https://iframe.videodelivery.net",
    "https://imagedelivery.net",
    "https://images.pexels.com", // stock album backgrounds (customization panel)
    `https://${R2_ACCOUNT}.r2.cloudflarestorage.com`,
  ].join(" "),
  "font-src 'self' data:",
  [
    "connect-src 'self'",
    `https://${SUPABASE_HOST}`,
    `wss://${SUPABASE_HOST}`,
    `https://${R2_ACCOUNT}.r2.cloudflarestorage.com`,
    "https://videos.hushare.space",
    "https://upload.videodelivery.net",
    "https://upload.cloudflarestream.com",
    "https://challenges.cloudflare.com",
    "https://static.cloudflareinsights.com",
    "https://cloudflareinsights.com",
  ].join(" "),
  "media-src 'self' blob: https://videos.hushare.space https://videodelivery.net https://iframe.videodelivery.net",
  "frame-src 'self' https://challenges.cloudflare.com https://iframe.videodelivery.net",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  // Polar checkout: the checkout form POSTs to /api/checkout, which 303-redirects to Polar's
  // hosted checkout. Modern browsers enforce form-action on redirect targets too, so Polar's
  // domains must be allow-listed here or the redirect is silently blocked ("click does nothing").
  "form-action 'self' https://polar.sh https://*.polar.sh",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy",   value: CSP },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options",    value: "nosniff" },
  { key: "X-Frame-Options",           value: "DENY" },
  { key: "Referrer-Policy",           value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy",        value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  transpilePackages: ["cobe"],
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      {
        source: "/(about|pricing|terms|privacy|collabs|support|shared-photo-album|wedding-photo-sharing|event-photo-sharing|qr-code-photo-album)(.*)",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      },
    ];
  },
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 2592000,
    remotePatterns: [
      { protocol: "https", hostname: "videos.hushare.space" },
      { protocol: "https", hostname: "videodelivery.net" },
      { protocol: "https", hostname: "iframe.videodelivery.net" },
      { protocol: "https", hostname: "imagedelivery.net" },
      { protocol: "https", hostname: `${R2_ACCOUNT}.r2.cloudflarestorage.com` },
    ],
  },
};

export default nextConfig;
