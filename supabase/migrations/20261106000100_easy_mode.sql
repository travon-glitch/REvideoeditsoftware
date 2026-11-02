-- ════════════════════════════════════════════════════════════════════════════
-- Stage 6 — Easy Mode
--   • Real photo thumbnails (small JPEGs stored next to each photo)
--   • The six Easy Mode video styles as the built-in templates
-- ════════════════════════════════════════════════════════════════════════════

alter table public.media_assets add column thumbnail_path text;
alter table public.media_assets add constraint media_assets_thumbnail_folder check (
  thumbnail_path is null
  or (bucket = 'listing-media' and listing_id is not null
      and thumbnail_path like organization_id::text || '/listings/' || listing_id::text || '/%.thumb.jpg'));

-- Built-in styles (original designs). Existing rows are updated in place so projects keep their template.
update public.video_templates set name = 'Luxury Cinematic',
  description = 'Slow, elegant camera moves with refined titles.', aspect_ratios = '{16:9,9:16}', sort_order = 1
  where organization_id is null and slug = 'luxury';
update public.video_templates set name = 'Modern',
  description = 'Clean, quick cuts with bold, simple text.', aspect_ratios = '{16:9,9:16}', sort_order = 2
  where organization_id is null and slug = 'modern';
update public.video_templates set slug = 'social-reel', name = 'Social Media Reel',
  description = 'A short, fast vertical video for Reels, TikTok and Shorts.', aspect_ratios = '{9:16}', sort_order = 5
  where organization_id is null and slug = 'quick-social';
update public.video_templates set name = 'Open House',
  description = 'Invites people with the date and time up front.', aspect_ratios = '{16:9,1:1,9:16}', sort_order = 4
  where organization_id is null and slug = 'open-house';
update public.video_templates set is_active = false where organization_id is null and slug = 'just-sold';

insert into public.video_templates (organization_id, slug, name, description, aspect_ratios, style, sort_order) values
  (null, 'just-listed', 'Just Listed', 'Announces a new listing with a bold “Just Listed” banner.', '{16:9,9:16}', '{}', 3),
  (null, 'highlights', 'Property Highlights', 'Shows the key facts — bedrooms, bathrooms, size — one by one.', '{16:9,1:1}', '{}', 6)
on conflict (organization_id, slug) do nothing;
