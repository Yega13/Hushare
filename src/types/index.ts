export type MediaType = "image" | "video";
export type StorageBackend = "r2" | "stream";
export type MediaDisplayFilter = "none" | "warm" | "cool" | "mono" | "vintage" | "soft";
export type MediaHoverEffect = "none" | "mono" | "fade" | "zoom" | "lift";
export type MobileGridColumns = 3 | 4 | 5 | 6;
export type PhotoLayout = "grid" | "justified";
// Retired as a user-facing choice — kept as the fallback for albums that have never touched the
// composable controls below, so their slideshow keeps the look they already had.
export type SlideshowAnimation = "none" | "fade" | "rise" | "zoom";
export type SlideshowMove = "none" | "slide" | "zoomIn" | "zoomOut";
// Where the incoming photo travels FROM.
export type SlideshowDirection = "up" | "down" | "left" | "right";
export type SlideshowEasing = "smooth" | "even" | "gentle" | "sharp" | "spring";
// A composed slideshow transition. distance/fade/blur are neutral 0-100 axes; what they mean in
// pixels lives in lib/slideshow-motion.ts so the feel can be retuned without a migration.
export type SlideshowMotion = {
  move: SlideshowMove;
  direction: SlideshowDirection;
  distance: number;
  fade: number;
  blur: number;
  durationMs: number;
  easing: SlideshowEasing;
};
export type Tier = "free" | "pro" | "studio";
export type UploadCaps = { image: number; video: number };
export type SponsorLogo = { id: string; url: string; name: string | null };
// How a video used as the album header plays. 'hoverPlay'/'hoverLoop' fall back to a static
// poster on touch devices, which have no hover.
export type HeaderVideoMode = "once" | "loop" | "hoverPlay" | "hoverLoop";

// Shape returned by GET /api/album/resolve — internal columns (owner_token, password_hash,
// user_id, retired_at) are stripped server-side and never appear on the client.
export type Album = {
  id: string;
  slug: string;
  custom_slug: string | null;
  title: string;
  background_theme: string | null;
  cover_photo_id: string | null;
  // Custom header photo — an arbitrary uploaded image (R2 URL), not one of the album's own photos.
  // Mutually exclusive with cover_photo_id: at most one is ever set.
  header_image: string | null;
  // Where the header photo/video is anchored within the hero band's crop, as a CSS
  // background-position value ("X% Y%"). Null = center.
  header_focal: string | null;
  // Header photo zoom as a percentage of cover size (100 = no zoom). Null = 100.
  header_zoom: number | null;
  // Playback mode when the chosen header photo is a video. Null = 'loop'.
  header_video_mode: HeaderVideoMode | null;
  // Album design (Part A). accent_color: curated palette (all) or custom hex (paid). logo_url:
  // owner-uploaded logo (paid). template: one-click preset key. welcome_message: welcome-header line.
  // hide_branding: paid — hides "Powered by Hushare". All default empty → legacy albums look unchanged.
  accent_color: string | null;
  logo_url: string | null;
  // Sponsor-branding strip (race/festival albums), owner-ordered. Paid, same gate as logo_url.
  // Empty array (the default) shows no strip.
  sponsor_logos: SponsorLogo[];
  template: string | null;
  // Owner-selectable title font (key into ALBUM_FONTS); null = the default classic serif.
  title_font: string | null;
  // How the photo tiles present (edge / rounded / framed); null = default (per-album media_radius).
  photo_style: string | null;
  welcome_message: string | null;
  hide_branding: boolean;
  reveal_at: string | null;
  media_radius: number;
  video_autoplay: boolean;
  media_filter: MediaDisplayFilter;
  media_hover: MediaHoverEffect;
  mobile_grid_columns: MobileGridColumns;
  photo_layout: PhotoLayout;
  slideshow_interval_ms: number;
  slideshow_animation: SlideshowAnimation;
  // Composed transition. NULL on any album whose owner has never opened the slideshow controls —
  // resolveSlideshowMotion() then derives it from slideshow_animation above.
  slideshow_motion: SlideshowMotion | null;
  allow_guest_downloads: boolean;
  guest_uploads_enabled: boolean;
  // When true, GUEST uploads are hidden (pending) until the owner approves them.
  require_approval: boolean;
  // Owner opt-in (Studio tier) for AI Face Finder — lets guests find photos of themselves.
  face_finder_enabled: boolean;
  // Owner switch: 'this is a race' — enables bib-number OCR + guest search on this album.
  bib_search_enabled: boolean;
  // Race numbering bounds. Detections outside them are ignored at SEARCH time (never at indexing
  // time), so correcting a wrong range is instant and costs no re-OCR. NULL = unbounded that end.
  bib_min: number | null;
  bib_max: number | null;
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
  // Intrinsic pixel dimensions captured at upload — lets the UI know the exact aspect ratio
  // without measuring a poster. Null for legacy rows / when capture failed.
  width: number | null;
  height: number | null;
  face_ids?: string[] | null;
  // Race bib numbers read from this photo by OCR. Null = not indexed yet; [] = indexed, none found.
  bib_numbers?: string[] | null;
  // Moderation: a hidden photo is shown to the OWNER only (pending approval, or hidden by the owner);
  // guests never receive it. Absent on legacy rows → treated as visible.
  hidden?: boolean;
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
