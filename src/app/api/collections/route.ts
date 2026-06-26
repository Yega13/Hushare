import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireTier } from '@/lib/subscriptions'
import { validateCustomSlug } from '@/lib/custom-slug'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { verifyOwnerViaCookie } from '@/lib/album-owner-access'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type AlbumForCollection = { id: string; owner_token: string; user_id: string | null }
type CollectionSummary = {
  id: string
  name: string
  slug: string
  description: string | null
  created_at: string
}

// GET /api/collections?slug=<albumSlug>
// Lists the authenticated user's collections. If ?slug= is provided, each
// collection also includes contains_album (bool) for use in the toolbar picker.
export async function GET(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  const { searchParams } = new URL(req.url)
  const albumSlug = (searchParams.get('slug') ?? '').trim()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Sign in to view collections' }, { status: 401, headers: NO_STORE })
  }
  const gate = await requireTier(user, 'studio')
  if (gate) {
    return NextResponse.json({ error: 'Studio plan required' }, { status: 403, headers: NO_STORE })
  }

  const admin = createAdminClient()
  let album: { id: string } | null = null
  if (albumSlug) {
    const verified = await verifyOwnedAlbum(albumSlug)
    // If album ownership check fails, silently ignore the slug — the collection list
    // still loads but without the contains_album context (all will be false).
    if (!('error' in verified)) {
      album = verified.album
    }
  }

  const { data: collections, error } = await admin
    .from('collections')
    .select('id, name, slug, description, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .returns<CollectionSummary[]>()

  if (error) {
    console.error('[collections] list failed:', error.message)
    return NextResponse.json({ error: 'Could not load collections' }, { status: 500, headers: NO_STORE })
  }

  const collectionIds = (collections ?? []).map((c) => c.id)
  const { data: links } = collectionIds.length
    ? await admin
        .from('collection_albums')
        .select('collection_id, album_id')
        .in('collection_id', collectionIds)
        .returns<Array<{ collection_id: string; album_id: string }>>()
    : { data: [] as Array<{ collection_id: string; album_id: string }> }

  const shaped = (collections ?? []).map((c) => {
    const cLinks = (links ?? []).filter((l) => l.collection_id === c.id)
    return {
      ...c,
      album_count: cLinks.length,
      contains_album: album ? cLinks.some((l) => l.album_id === album!.id) : false,
    }
  })

  return NextResponse.json({ collections: shaped }, { headers: NO_STORE })
}

// POST /api/collections
// Two modes:
//   1. { name, collection_slug, description? }           — create a new collection
//   2. { collection_id, slug }                           — add album to existing collection
//   3. { name, collection_slug, slug, description? }     — create collection AND add album
export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  const rl = await checkRateLimit(clientIpKey(req, 'collections_post'), 60, 30, { failOpen: false })
  if (!rl.ok) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds), ...NO_STORE } })
  }

  let body: {
    slug?: string
    name?: string
    description?: string
    collection_slug?: string
    collection_id?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const albumSlug = String(body.slug ?? '').trim()
  const collectionId = String(body.collection_id ?? '').trim()
  const name = String(body.name ?? '').trim().slice(0, 80)
  const description = String(body.description ?? '').trim().slice(0, 240)
  const rawCollectionSlug = String(body.collection_slug ?? slugFromName(name)).trim()

  const hasAlbum = !!albumSlug
  const isCreatingNew = !collectionId

  if (isCreatingNew && !name) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400, headers: NO_STORE })
  }
  if (!isCreatingNew && !hasAlbum) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400, headers: NO_STORE })
  }
  if (!isCreatingNew && !UUID_RE.test(collectionId)) {
    return NextResponse.json({ error: 'Invalid collection_id' }, { status: 400, headers: NO_STORE })
  }

  let normalizedCollectionSlug = ''
  if (isCreatingNew) {
    const validation = validateCustomSlug(rawCollectionSlug)
    if (!validation.ok) {
      return NextResponse.json({ error: validation.reason }, { status: 400, headers: NO_STORE })
    }
    normalizedCollectionSlug = validation.slug
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Sign in to create a collection' }, { status: 401, headers: NO_STORE })
  }
  const gate = await requireTier(user, 'studio')
  if (gate) {
    return NextResponse.json({ error: 'Studio plan required' }, { status: 403, headers: NO_STORE })
  }

  const admin = createAdminClient()

  let album: AlbumForCollection | null = null
  if (hasAlbum) {
    const verified = await verifyOwnedAlbum(albumSlug)
    if ('error' in verified) return verified.error
    album = verified.album
  }

  const collection = collectionId
    ? await getExistingCollection(admin, collectionId, user.id)
    : await createCollection(admin, user.id, name, normalizedCollectionSlug, description)

  if ('error' in collection) return collection.error

  if (album) {
    // Claim the album to the user's account if it was created anonymously.
    await admin.from('albums').update({ user_id: user.id }).eq('id', album.id).is('user_id', null)

    const { error: linkError } = await admin
      .from('collection_albums')
      .upsert(
        { collection_id: collection.collection.id, album_id: album.id, sort_order: 0 },
        { onConflict: 'collection_id,album_id' },
      )

    if (linkError) {
      console.error('[collections] link failed:', linkError.message)
      return NextResponse.json(
        { error: 'Album could not be added to the collection' },
        { status: 500, headers: NO_STORE },
      )
    }
  }

  return NextResponse.json({ ok: true, collection: collection.collection }, { headers: NO_STORE })
}

// PATCH /api/collections — rename/reslug/redescribe a collection
export async function PATCH(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  const rl = await checkRateLimit(clientIpKey(req, 'collections_patch'), 60, 30, { failOpen: false })
  if (!rl.ok) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds), ...NO_STORE } })
  }

  let body: { collection_id?: string; name?: string; description?: string; collection_slug?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const collectionId = String(body.collection_id ?? '').trim()
  const name = String(body.name ?? '').trim().slice(0, 80)
  const description = String(body.description ?? '').trim().slice(0, 240)
  const rawSlug = String(body.collection_slug ?? '').trim()
  if (!collectionId || !name || !rawSlug) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400, headers: NO_STORE })
  }
  if (!UUID_RE.test(collectionId)) {
    return NextResponse.json({ error: 'Invalid collection_id' }, { status: 400, headers: NO_STORE })
  }

  const slugValidation = validateCustomSlug(rawSlug)
  if (!slugValidation.ok) {
    return NextResponse.json({ error: slugValidation.reason }, { status: 400, headers: NO_STORE })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Sign in to edit a collection' }, { status: 401, headers: NO_STORE })
  }
  const gate = await requireTier(user, 'studio')
  if (gate) {
    return NextResponse.json({ error: 'Studio plan required' }, { status: 403, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { data: collection, error: lookupError } = await admin
    .from('collections')
    .select('id')
    .eq('id', collectionId)
    .eq('user_id', user.id)
    .maybeSingle<{ id: string }>()

  if (lookupError || !collection) {
    return NextResponse.json({ error: 'Collection not found' }, { status: 404, headers: NO_STORE })
  }

  const { data: updated, error: updateError } = await admin
    .from('collections')
    .update({
      name,
      slug: slugValidation.slug,
      description: description || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', collection.id)
    .select('id, name, slug, description')
    .single<{ id: string; name: string; slug: string; description: string | null }>()

  if (updateError) {
    if ((updateError as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'That collection URL is already taken' }, { status: 409, headers: NO_STORE })
    }
    console.error('[collections] update failed:', updateError.message)
    return NextResponse.json({ error: 'Could not update collection' }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true, collection: updated }, { headers: NO_STORE })
}

// DELETE /api/collections — remove a collection (albums are NOT deleted, just unlinked)
export async function DELETE(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  const rl = await checkRateLimit(clientIpKey(req, 'collections_delete'), 60, 30, { failOpen: false })
  if (!rl.ok) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds), ...NO_STORE } })
  }

  let body: { collection_id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const collectionId = String(body.collection_id ?? '').trim()
  if (!collectionId) {
    return NextResponse.json({ error: 'Missing collection_id' }, { status: 400, headers: NO_STORE })
  }
  if (!UUID_RE.test(collectionId)) {
    return NextResponse.json({ error: 'Invalid collection_id' }, { status: 400, headers: NO_STORE })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Sign in to delete a collection' }, { status: 401, headers: NO_STORE })
  }
  const gate = await requireTier(user, 'studio')
  if (gate) {
    return NextResponse.json({ error: 'Studio plan required' }, { status: 403, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { data: collection, error: lookupError } = await admin
    .from('collections')
    .select('id')
    .eq('id', collectionId)
    .eq('user_id', user.id)
    .maybeSingle<{ id: string }>()

  if (lookupError || !collection) {
    return NextResponse.json({ error: 'Collection not found' }, { status: 404, headers: NO_STORE })
  }

  // Delete links first (FK), then the collection row.
  const { error: linksError } = await admin.from('collection_albums').delete().eq('collection_id', collection.id)
  if (linksError) {
    console.error('[collections] link delete failed:', linksError.message)
    return NextResponse.json({ error: 'Could not delete collection' }, { status: 500, headers: NO_STORE })
  }

  const { error: deleteError } = await admin.from('collections').delete().eq('id', collection.id)
  if (deleteError) {
    console.error('[collections] delete failed:', deleteError.message)
    return NextResponse.json({ error: 'Could not delete collection' }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}

// ── helpers ────────────────────────────────────────────────────────────────

async function verifyOwnedAlbum(
  albumSlug: string,
): Promise<{ album: AlbumForCollection } | { error: NextResponse }> {
  const access = await verifyOwnerViaCookie<AlbumForCollection>(albumSlug)
  if (!access.ok) {
    return {
      error: NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE }),
    }
  }
  return { album: access.album }
}

async function getExistingCollection(
  admin: ReturnType<typeof createAdminClient>,
  collectionId: string,
  userId: string,
): Promise<{ collection: { id: string; slug: string; name: string } } | { error: NextResponse }> {
  const { data: collection, error } = await admin
    .from('collections')
    .select('id, slug, name')
    .eq('id', collectionId)
    .eq('user_id', userId)
    .maybeSingle<{ id: string; slug: string; name: string }>()

  if (error || !collection) {
    return {
      error: NextResponse.json({ error: 'Collection not found' }, { status: 404, headers: NO_STORE }),
    }
  }
  return { collection }
}

async function createCollection(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  name: string,
  slug: string,
  description: string,
): Promise<{ collection: { id: string; slug: string; name: string } } | { error: NextResponse }> {
  const { data: collection, error } = await admin
    .from('collections')
    .insert({ user_id: userId, name, slug, description: description || null })
    .select('id, slug, name')
    .single<{ id: string; slug: string; name: string }>()

  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return {
        error: NextResponse.json(
          { error: 'That collection URL is already taken' },
          { status: 409, headers: NO_STORE },
        ),
      }
    }
    console.error('[collections] create failed:', error.message)
    return {
      error: NextResponse.json({ error: 'Could not create collection' }, { status: 500, headers: NO_STORE }),
    }
  }

  return { collection }
}

function slugFromName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'collection'
  )
}
