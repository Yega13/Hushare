export type MediaType = "image" | "video";
export type StorageBackend = "r2" | "stream";

export type Album = {
  id: string;
  slug: string;
  title: string | null;
  description: string | null;
  user_id: string | null;
  created_at: string;
  last_activity_at: string;
  background_theme: string | null;
};

export type Photo = {
  id: string;
  album_id: string;
  media_type: MediaType;
  storage_backend: StorageBackend;
  // R2 fields (images + video mirrors)
  storage_path: string | null;
  url: string | null;
  thumb_path: string | null;
  thumb_url: string | null;
  // Stream fields (videos)
  stream_uid: string | null;
  stream_iframe_url: string | null;
  stream_thumbnail_url: string | null;
  // Shared
  poster_url: string | null;
  caption: string | null;
  sort_order: number;
  created_at: string;
};

export type UploadItem = {
  id: string;
  file: File;
  status: "pending" | "uploading" | "done" | "error";
  progress: number;
  error?: string;
};
