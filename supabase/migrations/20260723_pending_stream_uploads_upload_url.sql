-- Store the REAL Cloudflare Stream TUS upload URL (the exact `Location` header captured at
-- creation time in src/lib/cloudflare/stream.ts createStreamUpload) so the video-upload relay
-- fallback (src/app/api/upload/stream-relay/[uid]/route.ts) can forward to it without ever
-- reconstructing/guessing Cloudflare's URL format from just the uid. Nullable + idempotent:
-- existing rows get NULL (harmless — they're within the 24h token TTL and Cloudflare's own 2h
-- upload-URL expiry is the real bottleneck anyway); every new row populates it going forward.

alter table public.pending_stream_uploads add column if not exists upload_url text;
