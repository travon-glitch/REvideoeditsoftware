/*
 * Database types for supabase-js, written to match
 * supabase/migrations/20261102000100_foundation.sql.
 * Regenerate with `supabase gen types typescript --local` once a local stack runs.
 */
import type { Role, UserStatus } from "@/lib/auth/roles";

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type ListingStatus = "coming_soon" | "for_sale" | "open_house" | "pending" | "sold" | "for_rent";
export type AssetKind = "photo" | "video" | "audio" | "logo" | "ai_clip" | "render" | "headshot";
export type VideoStatus =
  | "draft" | "generating" | "ready_for_review" | "approved" | "rendering" | "completed" | "failed" | "archived";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type OrganizationRow = {
  id: string; name: string; slug: string; created_at: string; updated_at: string;
};
export type ProfileRow = {
  id: string; organization_id: string; email: string; full_name: string; first_name: string; last_name: string;
  job_title: string | null; role: Role; status: UserStatus; status_changed_at: string; is_active: boolean;
  can_download: boolean; can_use_ai: boolean; max_videos_per_month: number | null;
  max_ai_generations_per_month: number | null; invited_by: string | null;
  ui_mode: "easy" | "advanced"; avatar_path: string | null; created_at: string; updated_at: string;
  can_batch_generate: boolean;
};
export type ProjectMemberRow = {
  project_id: string; user_id: string; organization_id: string; access: "viewer" | "editor";
  assigned_by: string | null; created_at: string;
};
export type OrganizationSettingsRow = {
  organization_id: string; ai_enabled: boolean; monthly_ai_budget_cents: number | null;
  default_max_videos_per_month: number | null; default_max_ai_generations_per_month: number | null;
  viewers_can_download_by_default: boolean; updated_by: string | null; updated_at: string;
  max_batch_size: number; concurrent_render_limit: number; daily_video_limit: number | null;
  claude_enabled: boolean; claude_model: string; claude_monthly_run_limit: number | null; claude_daily_runs_per_user: number | null;
  require_logo: boolean; require_disclosure: boolean; require_agent_card: boolean; lock_brand_fonts: boolean; lock_brand_colors: boolean;
  ai_depth_motion_enabled: boolean; ai_voiceover_enabled: boolean; ai_captions_enabled: boolean;
  video_ai_provider: "muapi"; video_ai_model: string; video_ai_clip_cost_cents: number;
  daily_ai_budget_cents: number | null; ai_budget_alert_percent: number;
};
export type DirectorRunRow = {
  id: string; organization_id: string; listing_id: string | null; project_id: string | null; created_by: string | null;
  style: string; model: string; status: JobStatus; photo_count: number; analysis: Json | null; storyboard: Json | null;
  warnings: Json; usage: Json; cost_cents: number; error_message: string | null; created_at: string; finished_at: string | null;
};
export type OrganizationSecretRow = {
  organization_id: string; name: string; ciphertext: string; last4: string; updated_by: string | null; updated_at: string;
};
export type BrandKitRow = {
  id: string; organization_id: string; name: string; is_default: boolean; company_name: string | null;
  tagline: string | null; primary_color: string; secondary_color: string; accent_color: string;
  heading_font: string; body_font: string; logo_path: string | null; outro_text: string | null;
  disclaimer: string | null; created_by: string | null; created_at: string; updated_at: string;
  brokerage_name: string | null; brokerage_license: string | null; brokerage_logo_path: string | null;
  intro_style: "none" | "logo-reveal" | "bar-wipe" | "title-card"; outro_style: "none" | "agent-card" | "logo-end" | "contact-bar";
  agent_layout: "photo-left" | "centered" | "minimal"; disclosure_required: boolean;
  music_mood: "elegant" | "calm" | "upbeat" | "warm" | "inspiring"; music_follow_template: boolean; music_asset_id: string | null; music_volume: number;
};
export type AgentProfileRow = {
  id: string; organization_id: string; user_id: string | null; name: string; title: string | null; phone: string | null;
  email: string | null; brokerage: string | null; license: string | null; headshot_asset_id: string | null; is_active: boolean;
  created_by: string | null; created_at: string; updated_at: string;
};
export type ListingRow = {
  id: string; organization_id: string; created_by: string | null; address_line: string; city: string | null;
  state: string | null; postal_code: string | null; price: number | null; bedrooms: number | null;
  bathrooms: number | null; square_feet: number | null; description: string | null; mls_number: string | null;
  status: ListingStatus; created_at: string; updated_at: string;
  workflow_state: "draft" | "ready"; property_type: string | null; agent_name: string | null; brokerage: string | null;
  contact_phone: string | null; contact_email: string | null; open_house_date: string | null;
  open_house_start: string | null; open_house_end: string | null; cover_asset_id: string | null; updated_by: string | null;
  agent_profile_id: string | null; previous_price: number | null;
};
export type ListingMemberRow = {
  listing_id: string; user_id: string; organization_id: string; access: "viewer" | "editor";
  assigned_by: string | null; created_at: string;
};
export type MediaAssetRow = {
  id: string; organization_id: string; listing_id: string | null; uploaded_by: string | null; kind: AssetKind;
  bucket: "listing-media" | "brand-assets" | "video-exports" | "project-media" | "ai-clips" | "music-library"; storage_path: string; file_name: string;
  mime_type: string; size_bytes: number; width: number | null; height: number | null;
  duration_seconds: number | null; room_label: string | null; sort_order: number; created_at: string;
  project_id: string | null; thumbnail_path: string | null;
  camera_spec: Json | null; source_asset_id: string | null; generation_job_id: string | null; ai_review: Json | null; ai_decision: Json | null;
};
export type VideoTemplateRow = {
  id: string; organization_id: string | null; slug: string; name: string; description: string;
  aspect_ratios: string[]; style: Json; document: Json | null; is_active: boolean; sort_order: number;
  created_at: string; updated_at: string;
  builtin_key: string | null; status: "draft" | "approved" | "disabled"; usage: string; default_for: ListingStatus[];
  created_by: string | null; approved_by: string | null; approved_at: string | null;
};
export type VideoProjectRow = {
  id: string; organization_id: string; listing_id: string | null; template_id: string | null;
  brand_kit_id: string | null; created_by: string | null; title: string; status: VideoStatus;
  aspect_ratios: string[]; settings: Json; document: Json | null; revision: number;
  thumbnail_path: string | null; created_at: string; updated_at: string; edit_plan: Json | null;
  batch_id: string | null; batch_type: string | null; batch_variation: number;
  restricted: boolean; locked: boolean; archived_at: string | null; archived_by: string | null;
};
export type UserActivityRow = {
  id: string; full_name: string; email: string; role: Role; status: string; job_title: string | null;
  can_download: boolean; can_use_ai: boolean; can_batch_generate: boolean;
  max_videos_per_month: number | null; max_ai_generations_per_month: number | null;
  projects_owned: number; projects_assigned: number; listings_owned: number;
  videos_rendered: number; videos_this_month: number; ai_jobs_this_month: number; ai_generations_total: number;
  storage_bytes: number; last_activity_at: string | null; last_activity: string | null;
};
export type AiUsageRow = {
  id: string; at: string; kind: "video_clip" | "depth_clip" | "director" | "voiceover" | "transcription"; provider: string; model: string;
  user_id: string | null; status: string; cost_cents: number; error_message: string | null; project_id: string | null; listing_id: string | null;
};
export type ProjectRevisionRow = {
  project_id: string; revision: number; organization_id: string; document: Json; author_id: string | null;
  note: string | null; created_at: string;
};
export type GenerationJobRow = {
  id: string; organization_id: string; project_id: string | null; listing_id: string | null;
  source_asset_id: string | null; requested_by: string | null;
  kind: "image_to_video" | "text_to_video" | "image_edit" | "voiceover"; provider: string; model: string;
  camera_move: string | null; input: Json; status: JobStatus; provider_job_id: string | null;
  output_asset_id: string | null; error_message: string | null; cost_estimate_cents: number | null;
  cost_actual_cents: number | null; created_at: string; started_at: string | null; finished_at: string | null;
  progress: number; attempts: number; worker_id: string | null; review: Json | null;
};
export type VideoBatchRow = {
  id: string; organization_id: string; listing_id: string | null; created_by: string | null; size: number; analysis: Json; created_at: string;
  aspect: "16:9" | "9:16" | "1:1" | "4:5"; planner: "rules" | "ai_director";
};
export type MusicTrackRow = {
  id: string; organization_id: string; asset_id: string; title: string; artist: string | null; mood: string; bpm: number | null;
  license_type: "original_builtin" | "royalty_free" | "licensed" | "company_owned"; license_details: string; license_url: string | null;
  commercial_use_verified: boolean; verified_by: string | null; verified_at: string | null; builtin_key: string | null; created_at: string;
};
export type LibraryVideoRow = {
  id: string; organization_id: string; render_job_id: string; project_id: string | null; title: string; aspect: string;
  duration_seconds: number | null; output_path: string; saved_by: string | null; saved_at: string;
};
export type RenderJobRow = {
  id: string; organization_id: string; project_id: string; revision: number; preset: string; status: JobStatus;
  progress: number; output_asset_id: string | null; error_message: string | null; requested_by: string | null;
  created_at: string; started_at: string | null; finished_at: string | null;
  aspect: "16:9" | "9:16" | "1:1" | "4:5"; document: Json; attempts: number; worker_id: string | null; output_path: string | null;
  duration_seconds: number | null; width: number | null; height: number | null; size_bytes: number | null;
  label: string | null;
};
export type AuditLogRow = {
  id: number; organization_id: string | null; actor_id: string | null; action: string; target_type: string | null;
  target_id: string | null; metadata: Json; created_at: string;
};

type Table<Row, Required extends keyof Row, Updatable extends keyof Row = keyof Row> = {
  Row: Row;
  Insert: Pick<Row, Required> & Partial<Omit<Row, Required>>;
  Update: Partial<Pick<Row, Updatable>>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      organizations: Table<OrganizationRow, "name" | "slug", "name">;
      profiles: Table<ProfileRow, "id" | "organization_id" | "email", "first_name" | "last_name" | "ui_mode" | "avatar_path">;
      project_members: Table<ProjectMemberRow, "project_id" | "user_id" | "organization_id", never>;
      organization_settings: Table<OrganizationSettingsRow, "organization_id",
        "ai_enabled" | "monthly_ai_budget_cents" | "default_max_videos_per_month" | "default_max_ai_generations_per_month" | "viewers_can_download_by_default" | "updated_by"
        | "max_batch_size" | "concurrent_render_limit" | "daily_video_limit"
        | "claude_enabled" | "claude_model" | "claude_monthly_run_limit" | "claude_daily_runs_per_user"
        | "ai_depth_motion_enabled" | "ai_voiceover_enabled" | "ai_captions_enabled" | "video_ai_provider" | "video_ai_model"
        | "video_ai_clip_cost_cents" | "daily_ai_budget_cents" | "ai_budget_alert_percent">;
      agent_profiles: Table<AgentProfileRow, "organization_id" | "name">;
      director_runs: Table<DirectorRunRow, "organization_id" | "style" | "model" | "photo_count">;
      organization_secrets: Table<OrganizationSecretRow, "organization_id" | "name" | "ciphertext" | "last4">;
      video_batches: Table<VideoBatchRow, "organization_id" | "size">;
      music_tracks: Table<MusicTrackRow, "organization_id" | "asset_id" | "title" | "mood" | "license_type" | "license_details">;
      library_videos: Table<LibraryVideoRow, "organization_id" | "render_job_id" | "title" | "aspect" | "output_path">;
      brand_kits: Table<BrandKitRow, "organization_id" | "name">;
      listings: Table<ListingRow, "organization_id">;
      listing_members: Table<ListingMemberRow, "listing_id" | "user_id" | "organization_id", never>;
      media_assets: Table<MediaAssetRow, "organization_id" | "kind" | "bucket" | "storage_path" | "file_name" | "mime_type" | "size_bytes">;
      video_templates: Table<VideoTemplateRow, "slug" | "name">;
      video_projects: Table<VideoProjectRow, "organization_id" | "title">;
      project_revisions: Table<ProjectRevisionRow, "project_id" | "revision" | "organization_id" | "document">;
      generation_jobs: Table<GenerationJobRow, "organization_id" | "kind" | "provider" | "model">;
      render_jobs: Table<RenderJobRow, "organization_id" | "project_id" | "revision" | "preset">;
      audit_log: Table<AuditLogRow, "action">;
    };
    Views: { [_ in never]: never };
    Functions: {
      create_user_profile: {
        Args: {
          p_actor: string; p_user_id: string; p_email: string; p_first_name: string; p_last_name: string;
          p_job_title: string | null; p_role: Role; p_can_download: boolean; p_can_use_ai: boolean;
          p_max_videos: number | null; p_max_ai: number | null;
        };
        Returns: ProfileRow;
      };
      admin_update_user: {
        Args: {
          p_user_id: string; p_first_name: string; p_last_name: string; p_job_title: string | null; p_role: Role;
          p_can_download: boolean; p_can_use_ai: boolean; p_max_videos: number | null; p_max_ai: number | null;
        };
        Returns: ProfileRow;
      };
      admin_set_user_status: { Args: { p_user_id: string; p_status: "active" | "suspended" | "deactivated" }; Returns: ProfileRow };
      admin_record_access_reset: { Args: { p_user_id: string }; Returns: undefined };
      admin_assign_project: { Args: { p_project_id: string; p_user_id: string; p_access: "viewer" | "editor" }; Returns: ProjectMemberRow };
      admin_unassign_project: { Args: { p_project_id: string; p_user_id: string }; Returns: undefined };
      activate_self: { Args: Record<PropertyKey, never>; Returns: undefined };
      admin_assign_listing: { Args: { p_listing_id: string; p_user_id: string; p_access: "viewer" | "editor" }; Returns: ListingMemberRow };
      admin_unassign_listing: { Args: { p_listing_id: string; p_user_id: string }; Returns: undefined };
      reorder_listing_photos: { Args: { p_listing_id: string; p_asset_ids: string[] }; Returns: undefined };
      listing_access: { Args: { p_listing: string }; Returns: "none" | "read" | "edit" };
      project_access: { Args: { p_project: string }; Returns: "none" | "read" | "edit" };
      start_director_run: { Args: { p_listing_id: string; p_style: string; p_photo_count: number }; Returns: DirectorRunRow };
      claude_key_status: { Args: Record<PropertyKey, never>; Returns: Json };
      director_available: { Args: Record<PropertyKey, never>; Returns: boolean };
      start_video_batch: { Args: { p_listing_id: string; p_size: number; p_analysis?: Json; p_aspect?: string; p_planner?: string }; Returns: VideoBatchRow };
      my_generation_allowance: { Args: Record<PropertyKey, never>; Returns: Json };
      my_brand_rules: { Args: Record<PropertyKey, never>; Returns: Json };
      provider_key_status: { Args: Record<PropertyKey, never>; Returns: Json };
      my_ai_features: { Args: Record<PropertyKey, never>; Returns: Json };
      start_local_ai: { Args: { p_kind: "voiceover" | "transcription"; p_project: string; p_model: string }; Returns: string };
      finish_local_ai: { Args: { p_id: string; p_ok: boolean; p_error: string | null; p_details: Json }; Returns: undefined };
      admin_set_project_access: { Args: { p_project: string; p_restricted: boolean; p_locked: boolean }; Returns: VideoProjectRow };
      admin_archive_project: { Args: { p_project: string; p_archived: boolean }; Returns: VideoProjectRow };
      admin_reassign_project: { Args: { p_project: string; p_new_owner: string }; Returns: VideoProjectRow };
      admin_delete_project: { Args: { p_project: string; p_confirm_title: string }; Returns: Json };
      admin_dashboard: { Args: Record<PropertyKey, never>; Returns: Json };
      admin_user_activity: { Args: Record<PropertyKey, never>; Returns: UserActivityRow[] };
      admin_ai_usage: { Args: { p_kind?: string | null; p_status?: string | null; p_user?: string | null; p_before?: string | null; p_limit?: number }; Returns: AiUsageRow[] };
      admin_system_health: { Args: Record<PropertyKey, never>; Returns: Json };
      record_admin_action: { Args: { p_action: string; p_meta: Json }; Returns: undefined };
      worker_heartbeat: { Args: { p_worker: string; p_kind: "render" | "ai"; p_host: string; p_providers: string[]; p_job: string | null; p_done: number; p_error: string | null }; Returns: undefined };
      record_audio_authorization: { Args: { p_asset: string; p_purpose: string }; Returns: undefined };
      admin_set_brand_rules: { Args: { p_require_logo: boolean; p_require_disclosure: boolean; p_require_agent_card: boolean; p_lock_fonts: boolean; p_lock_colors: boolean }; Returns: undefined };
      admin_set_template_default: { Args: { p_template: string; p_statuses: ListingStatus[] }; Returns: undefined };
      admin_set_batch_permission: { Args: { p_user_id: string; p_allowed: boolean }; Returns: ProfileRow };
      review_ai_clip: { Args: { p_asset: string; p_decision: "approved" | "problem"; p_note?: string | null }; Returns: Json };
      bootstrap_is_complete: { Args: Record<PropertyKey, never>; Returns: boolean };
      bootstrap_create_token: { Args: { p_token_hash: string; p_ttl_minutes?: number }; Returns: string };
      bootstrap_check_token: { Args: { p_token_hash: string }; Returns: boolean };
      bootstrap_complete: {
        Args: {
          p_token_hash: string; p_user_id: string; p_email: string; p_full_name: string;
          p_org_name: string; p_org_slug: string;
        };
        Returns: string;
      };
    };
    Enums: {
      app_role: Role;
      listing_status: ListingStatus;
      asset_kind: AssetKind;
      video_status: VideoStatus;
      job_status: JobStatus;
    };
    CompositeTypes: { [_ in never]: never };
  };
};
