const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

type StreamUploadInit = {
  uploadUrl: string;
  streamUid: string;
  iframeUrl: string;
  thumbnailUrl: string;
};

// Creates a one-time TUS upload URL on Cloudflare Stream.
// The browser then uploads the video file directly to Stream — never through our server.
export async function createStreamUpload(
  fileSizeBytes: number,
  fileName: string
): Promise<StreamUploadInit> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_STREAM_TOKEN;

  if (!accountId || !token) {
    throw new Error("Missing Cloudflare Stream credentials");
  }

  const res = await fetch(
    `${CLOUDFLARE_API}/accounts/${accountId}/stream?direct_user=true`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Tus-Resumable": "1.0.0",
        "Upload-Length": String(fileSizeBytes),
        "Upload-Metadata": `name ${btoa(fileName)}`,
      },
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Stream init failed ${res.status}: ${body}`);
  }

  const uploadUrl = res.headers.get("Location");
  const streamUid = res.headers.get("stream-media-id");

  if (!uploadUrl || !streamUid) {
    throw new Error("Stream response missing Location or stream-media-id");
  }

  return {
    uploadUrl,
    streamUid,
    iframeUrl: `https://iframe.videodelivery.net/${streamUid}`,
    thumbnailUrl: `https://videodelivery.net/${streamUid}/thumbnails/thumbnail.jpg?time=1s&height=720&fit=clip`,
  };
}

export async function deleteStreamVideo(uid: string): Promise<void> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_STREAM_TOKEN;

  if (!accountId || !token) return;

  await fetch(`${CLOUDFLARE_API}/accounts/${accountId}/stream/${uid}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}
