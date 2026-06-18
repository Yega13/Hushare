import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createStreamUpload } from "@/lib/cloudflare/stream";
import { isAllowedVideo } from "@/lib/cloudflare/r2";

export const runtime = "nodejs";

// Returns a one-time TUS upload URL so the browser uploads the video
// directly to Cloudflare Stream — our server never touches the video bytes.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const { albumId, fileName, contentType, fileSize } = body ?? {};

  if (!albumId || !fileName || !contentType || !fileSize) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  if (!isAllowedVideo(contentType)) {
    return NextResponse.json({ error: "File type not allowed" }, { status: 415 });
  }

  const MAX_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB
  if (fileSize > MAX_BYTES) {
    return NextResponse.json({ error: "File too large" }, { status: 413 });
  }

  // Verify the album belongs to this user
  const { data: album, error: albumError } = await supabase
    .from("albums")
    .select("id")
    .eq("id", albumId)
    .eq("user_id", user.id)
    .single();

  if (albumError || !album) {
    return NextResponse.json({ error: "Album not found" }, { status: 404 });
  }

  const init = await createStreamUpload(fileSize, fileName);

  return NextResponse.json(init);
}
