import 'server-only'

// fal.ai client for Studio style edits. We use FLUX Kontext — it edits an image per a text prompt
// while preserving the subject/composition, which is exactly "keep the person, apply the style".
// Endpoint + auth verified against the live API (Authorization: Key <FAL_KEY>).
const FAL_BASE = 'https://fal.run'
const KONTEXT_MODEL = 'fal-ai/flux-pro/kontext'

function falKey(): string {
  const k = process.env.FAL_KEY
  if (!k) throw new Error('FAL_KEY not set')
  return k
}

export type FalImage = { url: string; width?: number; height?: number; content_type?: string }

// Apply `prompt` to `imageUrl` (must be publicly fetchable by fal). Returns the styled output image.
// Throws on any failure (balance/rate/model error) — the caller refunds credits on throw.
export async function falStyleEdit(
  imageUrl: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<FalImage> {
  const res = await fetch(`${FAL_BASE}/${KONTEXT_MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Key ${falKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      image_url: imageUrl,
      output_format: 'jpeg',
      safety_tolerance: '2',
    }),
    signal,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`fal ${res.status}: ${body.slice(0, 200)}`)
  }

  const data = (await res.json()) as { images?: FalImage[] }
  const image = data.images?.[0]
  if (!image?.url) throw new Error('fal returned no image')
  return image
}
