import type { NextConfig } from "next";

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
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://challenges.cloudflare.com https://static.cloudflareinsights.com https://embed.videodelivery.net",
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
    "https://www.google-analytics.com",
    "https://analytics.google.com",
    "https://stats.g.doubleclick.net",
  ].join(" "),
  "media-src 'self' blob: https://videos.hushare.space https://videodelivery.net https://iframe.videodelivery.net",
  "frame-src 'self' https://challenges.cloudflare.com https://iframe.videodelivery.net",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
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
