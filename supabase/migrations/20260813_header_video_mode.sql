-- Playback mode when the header photo is actually a video (cover_photo_id points at a video-type
-- photo — header_image, the custom-upload path, is always a static image). One of
-- 'once' | 'loop' | 'hoverPlay' | 'hoverLoop'. Null = default ('loop') when a video is the header;
-- meaningless otherwise.
alter table public.albums add column if not exists header_video_mode text;
