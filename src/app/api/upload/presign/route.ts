import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAllowedImage } from "@/lib/cloudflare/r2";
import { v4 as uuid } from "uuid";

export const runtime = "nodejs";

// Returns a presigned PUT URL so the browser uploads directly to R2.
// Validates auth + file type — never touches the file bytes itself.
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

  if (!isAllowedImage(contentType)) {
    return NextResponse.json({ error: "File type not allowed" }, { status: 415 });
  }

  const MAX_BYTES = 50 * 1024 * 1024; // 50 MB per image
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

  const ext = fileName.split(".").pop() ?? "bin";
  const key = `albums/${albumId}/${uuid()}.${ext}`;

  // TODO: replace with proper R2 presigned URL once Workers binding supports it.
  // For now we return the key and the server will handle the upload via a signed token.
  return NextResponse.json({ key, contentType });
}
