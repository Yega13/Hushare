export type MediaType = "image" | "video";
export type StorageBackend = "r2" | "stream";
export type MediaDisplayFilter = "none" | "warm" | "cool" | "mono" | "vintage" | "soft";
export type MediaHoverEffect = "none" | "mono" | "fade" | "zoom" | "lift";
export type MobileGridColumns = 3 | 4 | 5 | 6;
export type SlideshowAnimation = "none" | "fade" | "rise" | "zoom";
export type Tier = "free" | "pro" | "studio";
export type UploadCaps = { image: number; video: number };

// Shape returned by GET /api/album/resolve — internal columns (owner_token, password_hash,
// user_id, retired_at) are stripped server-side and never appear on the client.
export type Album = {
  id: string;
  slug: string;
  custom_slug: string | null;
  title: string;
  background_theme: string | null;
  cover_photo_id: string | null;
  reveal_at: string | null;
  media_radius: number;
  video_autoplay: boolean;
  media_filter: MediaDisplayFilter;
  media_hover: MediaHoverEffect;
  mobile_grid_columns: MobileGridColumns;
  slideshow_interval_ms: number;
  slideshow_animation: SlideshowAnimation;
  allow_guest_downloads: boolean;
  guest_uploads_enabled: boolean;
  // Derived server-side from password_hash presence — the hash itself is never sent
  password_protected: boolean;
  last_activity_at: string;
  last_notification_at: string | null;
  created_at: string;
};

export type Photo = {
  id: string;
  album_id: string;
  media_type: MediaType;
  storage_backend: StorageBackend;
  storage_path: string | null;
  // For R2 images: direct CDN URL. For Stream videos: the iframe embed URL (same column, dual meaning).
  // Never use photo.url as an <img> src for videos — use stream_iframe_url instead.
  url: string | null;
  thumb_url: string | null;
  stream_uid: string | null;
  stream_iframe_url: string | null;
  stream_thumbnail_url: string | null;
  poster_url: string | null;
  caption: string | null;
  author_name: string | null;
  sort_order: number | null;
  display_radius: number | null;
  display_filter: MediaDisplayFilter | null;
  duration_seconds: number | null;
  face_ids?: string[] | null;
  created_at: string;
};


export type Subscription = {
  id: string;
  user_id: string;
  polar_subscription_id: string;
  polar_customer_id: string;
  polar_product_id: string | null;
  tier: "pro" | "studio";
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at?: string;
};

export type Collection = {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  description: string | null;
  created_at: string;
};
