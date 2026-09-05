// GENERATED FROM THE LIVE DATABASE -- do not hand-edit.
//
//   node scripts/gen-db-types.mjs           regenerate
//   node scripts/gen-db-types.mjs --check   fail if this file has drifted
//
// This file is what makes a wrong column name a COMPILE error instead of an empty result
// at an event. Before it existed the Supabase clients were typed SupabaseClient<any>, so
// every .select() string in the product was checked by nobody, and 79 call sites carried
// a .returns<T>() that -- verified against postgrest-js 2.108.2 -- checks array-ness and
// nothing else. A misspelled column returned undefined rather than failing.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      active_sessions: {
        Row: {
          id: string
          last_seen: string
          path: string | null
        }
        Insert: {
          id: string
          last_seen?: string
          path?: string | null
        }
        Update: {
          id?: string
          last_seen?: string
          path?: string | null
        }
        Relationships: []
      }
      albums: {
        Row: {
          id: string
          user_id: string | null
          title: string
          slug: string
          custom_slug: string | null
          owner_token: string
          created_at: string
          background_theme: string | null
          last_activity_at: string
          retired_at: string | null
          media_radius: number
          video_autoplay: boolean
          media_filter: string
          mobile_grid_columns: number
          slideshow_interval_ms: number
          slideshow_animation: string
          last_notification_at: string | null
          expiry_warning_sent_at: string | null
          guest_uploads_enabled: boolean
          allow_guest_downloads: boolean
          cover_photo_id: string | null
          password_hash: string | null
          reveal_at: string | null
          face_finder_enabled: boolean
          photo_layout: string
          require_approval: boolean
          media_cap_override: number | null
          accent_color: string | null
          logo_url: string | null
          welcome_message: string | null
          hide_branding: boolean
          title_font: string | null
          photo_style: string | null
          header_image: string | null
          header_focal: string | null
          sponsor_logos: Json
          header_touched: boolean
          header_video_mode: string | null
          header_zoom: number | null
          bib_search_enabled: boolean
          bib_min: number | null
          bib_max: number | null
          slideshow_motion: Json | null
          face_consent_at: string | null
          face_consent_by: string | null
          branding_locked: boolean
          desktop_grid_columns: number | null
          photo_order: string
          package_tier: string | null
          package_expires_at: string | null
          package_last_order_id: string | null
          package_reminder_at: string | null
          deleted_at: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          title: string
          slug: string
          custom_slug?: string | null
          owner_token: string
          created_at?: string
          background_theme?: string | null
          last_activity_at?: string
          retired_at?: string | null
          media_radius?: number
          video_autoplay?: boolean
          media_filter?: string
          mobile_grid_columns?: number
          slideshow_interval_ms?: number
          slideshow_animation?: string
          last_notification_at?: string | null
          expiry_warning_sent_at?: string | null
          guest_uploads_enabled?: boolean
          allow_guest_downloads?: boolean
          cover_photo_id?: string | null
          password_hash?: string | null
          reveal_at?: string | null
          face_finder_enabled?: boolean
          photo_layout?: string
          require_approval?: boolean
          media_cap_override?: number | null
          accent_color?: string | null
          logo_url?: string | null
          welcome_message?: string | null
          hide_branding?: boolean
          title_font?: string | null
          photo_style?: string | null
          header_image?: string | null
          header_focal?: string | null
          sponsor_logos?: Json
          header_touched?: boolean
          header_video_mode?: string | null
          header_zoom?: number | null
          bib_search_enabled?: boolean
          bib_min?: number | null
          bib_max?: number | null
          slideshow_motion?: Json | null
          face_consent_at?: string | null
          face_consent_by?: string | null
          branding_locked?: boolean
          desktop_grid_columns?: number | null
          photo_order?: string
          package_tier?: string | null
          package_expires_at?: string | null
          package_last_order_id?: string | null
          package_reminder_at?: string | null
          deleted_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          title?: string
          slug?: string
          custom_slug?: string | null
          owner_token?: string
          created_at?: string
          background_theme?: string | null
          last_activity_at?: string
          retired_at?: string | null
          media_radius?: number
          video_autoplay?: boolean
          media_filter?: string
          mobile_grid_columns?: number
          slideshow_interval_ms?: number
          slideshow_animation?: string
          last_notification_at?: string | null
          expiry_warning_sent_at?: string | null
          guest_uploads_enabled?: boolean
          allow_guest_downloads?: boolean
          cover_photo_id?: string | null
          password_hash?: string | null
          reveal_at?: string | null
          face_finder_enabled?: boolean
          photo_layout?: string
          require_approval?: boolean
          media_cap_override?: number | null
          accent_color?: string | null
          logo_url?: string | null
          welcome_message?: string | null
          hide_branding?: boolean
          title_font?: string | null
          photo_style?: string | null
          header_image?: string | null
          header_focal?: string | null
          sponsor_logos?: Json
          header_touched?: boolean
          header_video_mode?: string | null
          header_zoom?: number | null
          bib_search_enabled?: boolean
          bib_min?: number | null
          bib_max?: number | null
          slideshow_motion?: Json | null
          face_consent_at?: string | null
          face_consent_by?: string | null
          branding_locked?: boolean
          desktop_grid_columns?: number | null
          photo_order?: string
          package_tier?: string | null
          package_expires_at?: string | null
          package_last_order_id?: string | null
          package_reminder_at?: string | null
          deleted_at?: string | null
        }
        Relationships: []
      }
      collection_albums: {
        Row: {
          collection_id: string
          album_id: string
          sort_order: number
          created_at: string
        }
        Insert: {
          collection_id: string
          album_id: string
          sort_order?: number
          created_at?: string
        }
        Update: {
          collection_id?: string
          album_id?: string
          sort_order?: number
          created_at?: string
        }
        Relationships: []
      }
      collections: {
        Row: {
          id: string
          user_id: string
          name: string
          slug: string
          description: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          slug: string
          description?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          slug?: string
          description?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      error_events: {
        Row: {
          id: number
          created_at: string
          level: string
          source: string
          message: string
          album_id: string | null
          context: Json | null
          ua: string | null
          resolved_at: string | null
        }
        Insert: {
          created_at?: string
          level?: string
          source: string
          message: string
          album_id?: string | null
          context?: Json | null
          ua?: string | null
          resolved_at?: string | null
        }
        Update: {
          created_at?: string
          level?: string
          source?: string
          message?: string
          album_id?: string | null
          context?: Json | null
          ua?: string | null
          resolved_at?: string | null
        }
        Relationships: []
      }
      package_order_grants: {
        Row: {
          order_id: string
          album_id: string
          source: string
          granted_at: string
        }
        Insert: {
          order_id: string
          album_id: string
          source: string
          granted_at?: string
        }
        Update: {
          order_id?: string
          album_id?: string
          source?: string
          granted_at?: string
        }
        Relationships: []
      }
      pending_stream_uploads: {
        Row: {
          stream_uid: string
          album_id: string
          created_at: string
          upload_url: string | null
          consumed_at: string | null
          declared_duration_seconds: number | null
        }
        Insert: {
          stream_uid: string
          album_id: string
          created_at?: string
          upload_url?: string | null
          consumed_at?: string | null
          declared_duration_seconds?: number | null
        }
        Update: {
          stream_uid?: string
          album_id?: string
          created_at?: string
          upload_url?: string | null
          consumed_at?: string | null
          declared_duration_seconds?: number | null
        }
        Relationships: []
      }
      photos: {
        Row: {
          id: string
          album_id: string
          storage_path: string | null
          storage_backend: string
          url: string | null
          media_type: string
          caption: string | null
          author_name: string | null
          poster_path: string | null
          poster_url: string | null
          created_at: string
          display_radius: number | null
          display_filter: string | null
          sort_order: number | null
          stream_uid: string | null
          stream_iframe_url: string | null
          stream_thumbnail_url: string | null
          mirror_path: string | null
          mirror_url: string | null
          thumb_path: string | null
          thumb_url: string | null
          duration_seconds: number | null
          face_ids: string[] | null
          width: number | null
          height: number | null
          hidden: boolean
          bib_numbers: string[] | null
        }
        Insert: {
          id?: string
          album_id: string
          storage_path?: string | null
          storage_backend?: string
          url?: string | null
          media_type?: string
          caption?: string | null
          author_name?: string | null
          poster_path?: string | null
          poster_url?: string | null
          created_at?: string
          display_radius?: number | null
          display_filter?: string | null
          sort_order?: number | null
          stream_uid?: string | null
          stream_iframe_url?: string | null
          stream_thumbnail_url?: string | null
          mirror_path?: string | null
          mirror_url?: string | null
          thumb_path?: string | null
          thumb_url?: string | null
          duration_seconds?: number | null
          face_ids?: string[] | null
          width?: number | null
          height?: number | null
          hidden?: boolean
          bib_numbers?: string[] | null
        }
        Update: {
          id?: string
          album_id?: string
          storage_path?: string | null
          storage_backend?: string
          url?: string | null
          media_type?: string
          caption?: string | null
          author_name?: string | null
          poster_path?: string | null
          poster_url?: string | null
          created_at?: string
          display_radius?: number | null
          display_filter?: string | null
          sort_order?: number | null
          stream_uid?: string | null
          stream_iframe_url?: string | null
          stream_thumbnail_url?: string | null
          mirror_path?: string | null
          mirror_url?: string | null
          thumb_path?: string | null
          thumb_url?: string | null
          duration_seconds?: number | null
          face_ids?: string[] | null
          width?: number | null
          height?: number | null
          hidden?: boolean
          bib_numbers?: string[] | null
        }
        Relationships: []
      }
      poll_votes: {
        Row: {
          id: string
          poll_key: string
          option_key: string
          voter_id: string
          created_at: string
        }
        Insert: {
          id?: string
          poll_key: string
          option_key: string
          voter_id: string
          created_at?: string
        }
        Update: {
          id?: string
          poll_key?: string
          option_key?: string
          voter_id?: string
          created_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          user_id: string
          avatar_url: string | null
          updated_at: string
        }
        Insert: {
          user_id: string
          avatar_url?: string | null
          updated_at?: string
        }
        Update: {
          user_id?: string
          avatar_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      rate_limit_counters: {
        Row: {
          key: string
          window_start: string
          hits: number
        }
        Insert: {
          key: string
          window_start: string
          hits?: number
        }
        Update: {
          key?: string
          window_start?: string
          hits?: number
        }
        Relationships: []
      }
      rate_limit_events: {
        Row: {
          id: number
          key: string
          created_at: string
        }
        Insert: {
          key: string
          created_at?: string
        }
        Update: {
          key?: string
          created_at?: string
        }
        Relationships: []
      }
      schema_migrations: {
        Row: {
          name: string
          applied_at: string
        }
        Insert: {
          name: string
          applied_at?: string
        }
        Update: {
          name?: string
          applied_at?: string
        }
        Relationships: []
      }
      statements: {
        Row: {
          id: string
          slug: string
          title: string
          summary: string | null
          body_html: string
          published_at: string
          created_at: string
          poll_key: string | null
        }
        Insert: {
          id?: string
          slug: string
          title: string
          summary?: string | null
          body_html: string
          published_at?: string
          created_at?: string
          poll_key?: string | null
        }
        Update: {
          id?: string
          slug?: string
          title?: string
          summary?: string | null
          body_html?: string
          published_at?: string
          created_at?: string
          poll_key?: string | null
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          id: string
          user_id: string
          polar_subscription_id: string
          polar_customer_id: string | null
          polar_product_id: string
          tier: string
          status: string
          current_period_end: string | null
          cancel_at_period_end: boolean
          created_at: string
          updated_at: string
          last_reminder_at: string | null
          polar_modified_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          polar_subscription_id: string
          polar_customer_id?: string | null
          polar_product_id: string
          tier: string
          status: string
          current_period_end?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          updated_at?: string
          last_reminder_at?: string | null
          polar_modified_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          polar_subscription_id?: string
          polar_customer_id?: string | null
          polar_product_id?: string
          tier?: string
          status?: string
          current_period_end?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          updated_at?: string
          last_reminder_at?: string | null
          polar_modified_at?: string | null
        }
        Relationships: []
      }
      system_state: {
        Row: {
          key: string
          value: string | null
          updated_at: string
        }
        Insert: {
          key: string
          value?: string | null
          updated_at?: string
        }
        Update: {
          key?: string
          value?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: Record<never, never>
    Functions: {
      admin_growth_series: {
        Args: {
        p_days: number | null
        }
        Returns: { day: string; albums: number; uploads: number }[]
      }
      admin_user_cohorts: {
        Args: {
        p_months?: number | null
        }
        Returns: { month: string; signups: number; still_active: number }[]
      }
      admin_user_overview: {
        Args: {
        p_limit?: number | null
        }
        Returns: { user_id: string; email: string; created_at: string; last_sign_in_at: string; albums: number; media: number; last_active: string }[]
      }
      admin_weekday_series: {
        Args: {
        p_days: number | null
        p_tz: string | null
        }
        Returns: { dow: number; albums: number; uploads: number }[]
      }
      album_is_open: {
        Args: {
        p_album_id: string | null
        }
        Returns: boolean
      }
      album_video_seconds: {
        Args: {
        p_album_id: string | null
        }
        Returns: number
      }
      batch_set_sort_order: {
        Args: {
        p_album_id: string | null
        p_ids: string[] | null
        p_orders: number[] | null
        }
        Returns: undefined
      }
      coalesce_error_event: {
        Args: {
        p_level: string | null
        p_source: string | null
        p_message: string | null
        p_album_id: string | null
        p_context: Json
        p_ua: string | null
        p_window_seconds?: number | null
        }
        Returns: undefined
      }
      find_user_id_by_email: {
        Args: {
        p_email: string | null
        }
        Returns: string
      }
      prune_error_events: {
        Args: Record<string, never>
        Returns: undefined
      }
      prune_rate_limit_events: {
        Args: Record<string, never>
        Returns: undefined
      }
      rate_limit_hit: {
        Args: {
        p_key: string | null
        p_window_seconds: number | null
        p_max: number | null
        }
        Returns: { allowed: boolean; retry_after: number }[]
      }
      reserve_album_video: {
        Args: {
        p_stream_uid: string | null
        p_album_id: string | null
        p_declared: number | null
        p_budget_seconds: number | null
        p_upload_url?: string | null
        }
        Returns: boolean
      }
      studio_add_credits: {
        Args: {
        p_user: string | null
        p_amount: number | null
        p_reason: string | null
        p_meta?: Json
        }
        Returns: number
      }
      studio_grant_monthly: {
        Args: {
        p_user: string | null
        p_amount: number | null
        p_month: string | null
        }
        Returns: number
      }
      studio_spend_credits: {
        Args: {
        p_user: string | null
        p_amount: number | null
        p_reason: string | null
        p_meta?: Json
        }
        Returns: number
      }
    }
    Enums: Record<never, never>
    CompositeTypes: Record<never, never>
  }
}

/** A table's row shape, for the places a select string cannot be a literal. */
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']
