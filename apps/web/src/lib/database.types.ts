/*
 * Database types for supabase-js, written to match
 * supabase/migrations/20261102000100_foundation.sql.
 * Regenerate with `supabase gen types typescript --local` once a local stack runs.
 */
import type { Role, UserStatus } from "@/lib/auth/roles";

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type ListingStatus = "coming_soon" | "for_sale" | "open_house" | "pending" | "sold" | "for_rent";
export type AssetKind = "photo" | "video" | "audio" | "logo" | "ai_clip" | "render";
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
};
export type ProjectMemberRow = {
  project_id: string; user_id: string; organization_id: string; access: "viewer" | "editor";
  assigned_by: string | null; created_at: string;
};
export type OrganizationSettingsRow = {
  organization_id: string; ai_enabled: boolean; monthly_ai_budget_cents: number | null;
  default_max_videos_per_month: number | null; default_max_ai_generations_per_month: number | null;
  viewers_can_download_by_default: boolean; updated_by: string | null; updated_at: string;
};
export type BrandKitRow = {
  id: string; organization_id: string; name: string; is_default: boolean; company_name: string | null;
  tagline: string | null; primary_color: string; secondary_color: string; accent_color: string;
  heading_font: string; body_font: string; logo_path: string | null; outro_text: string | null;
  disclaimer: string | null; created_by: string | null; created_at: string; updated_at: string;
};
export type ListingRow = {
  id: string; organization_id: string; created_by: string | null; address_line: string; city: string | null;
  state: string | null; postal_code: string | null; price: number | null; bedrooms: number | null;
  bathrooms: number | null; square_feet: number | null; description: string | null; mls_number: string | null;
  status: ListingStatus; created_at: string; updated_at: string;
  workflow_state: "draft" | "ready"; property_type: string | null; agent_name: string | null; brokerage: string | null;
  contact_phone: string | null; contact_email: string | null; open_house_date: string | null;
  open_house_start: string | null; open_house_end: string | null; cover_asset_id: string | null; updated_by: string | null;
};
export type ListingMemberRow = {
  listing_id: string; user_id: string; organization_id: string; access: "viewer" | "editor";
  assigned_by: string | null; created_at: string;
};
export type MediaAssetRow = {
  id: string; organization_id: string; listing_id: string | null; uploaded_by: string | null; kind: AssetKind;
  bucket: "listing-media" | "brand-assets" | "video-exports"; storage_path: string; file_name: string;
  mime_type: string; size_bytes: number; width: number | null; height: number | null;
  duration_seconds: number | null; room_label: string | null; sort_order: number; created_at: string;
  project_id: string | null;
};
export type VideoTemplateRow = {
  id: string; organization_id: string | null; slug: string; name: string; description: string;
  aspect_ratios: string[]; style: Json; document: Json | null; is_active: boolean; sort_order: number;
  created_at: string; updated_at: string;
};
export type VideoProjectRow = {
  id: string; organization_id: string; listing_id: string | null; template_id: string | null;
  brand_kit_id: string | null; created_by: string | null; title: string; status: VideoStatus;
  aspect_ratios: string[]; settings: Json; document: Json | null; revision: number;
  thumbnail_path: string | null; created_at: string; updated_at: string;
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
};
export type RenderJobRow = {
  id: string; organization_id: string; project_id: string; revision: number; preset: string; status: JobStatus;
  progress: number; output_asset_id: string | null; error_message: string | null; requested_by: string | null;
  created_at: string; started_at: string | null; finished_at: string | null;
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
        "ai_enabled" | "monthly_ai_budget_cents" | "default_max_videos_per_month" | "default_max_ai_generations_per_month" | "viewers_can_download_by_default" | "updated_by">;
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
