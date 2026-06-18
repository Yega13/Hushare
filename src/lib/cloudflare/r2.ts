const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const ALLOWED_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/ogg",
]);

export function isAllowedImage(mimeType: string) {
  return ALLOWED_IMAGE_TYPES.has(mimeType);
}

export function isAllowedVideo(mimeType: string) {
  return ALLOWED_VIDEO_TYPES.has(mimeType);
}

// Generates a presigned PUT URL so the browser uploads directly to R2.
// Called from /api/upload/presign — never exposes R2 credentials to the client.
export async function createPresignedUpload(
  bucket: R2Bucket,
  key: string,
  contentType: string,
  expiresInSeconds = 3600
): Promise<string> {
  const url = await bucket.createMultipartUpload(key, {
    httpMetadata: { contentType },
  });
  // R2 presigned URLs via the binding are not yet stable in all runtimes.
  // We return the key + a signed token instead and use the Worker to proxy.
  // This is a placeholder — swap for bucket.presignedPutUrl when available.
  void url;
  throw new Error("Use Workers binding presign — not implemented yet");
}

export function r2PublicUrl(key: string): string {
  const host = process.env.R2_PUBLIC_HOST;
  if (!host) throw new Error("R2_PUBLIC_HOST not set");
  return `https://${host}/${key}`;
}
