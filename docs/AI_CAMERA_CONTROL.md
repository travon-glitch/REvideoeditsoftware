# AI Camera Control

Describe a camera movement in plain English, keep the whole property photo visible (even in a tall
9:16 video), preview it and apply it to a scene of your video.

## Where it is

- **Video editor:** each scene has **AI Camera Control** (under the camera choice in Easy Mode; next to
  **Camera Studio** in the Advanced editor's scene panel). It opens Camera Studio on that scene's photo.
- **Camera Studio:** the **AI Camera Control** tab, next to **Move camera**.

## How to use it

1. **Framing:** *Show Entire Photo* (Full Image Visibility, the default for new moves), *Fill Screen* or
   *Smart Fit*.
2. **Movement:** pick a preset (Move Closer, Move Left, Move Right, Move Up, Move Down, Cinematic Reveal,
   Move Back, Luxury Camera Movement, Full Property Showcase), or type a request in
   **Describe Your Camera Movement** and press **Create movement**.
3. **Movement strength:** Gentle, Normal or Dramatic.
4. **How to make it:** *Standard camera movement* (your original photo, exact) or an AI method
   (*AI depth* or *Generative AI*, when switched on).
5. **Preview**, then **Apply Movement** (or **Generate AI Camera Clip** for an AI method).

**Advanced settings** (collapsed): video shape (16:9, 9:16, 1:1, 4:5), background (blurred photo, colour,
gradient), camera feel (gimbal), duration, easing, the advanced moves (push in, pull out, pan, tilt,
dolly, truck, crane, orbit, arc, parallax) and links to custom paths in Move camera / Advanced camera.

## What happens to a request

1. The server checks the person may use AI, Claude is switched on for the company, they can edit the
   photo's listing, the company's AI spending ceilings, and a 200-requests-a-day cap per person
   (`start_camera_prompt`).
2. Claude (the company's key from the AI control panel, the model chosen there) reads the request and the
   photo's preview image and answers in a fixed JSON format (movement, framing, preserveEntireImage,
   duration, intensity, aspectRatio, background, easing, feel, focus point, suggested method, explanation,
   conflicts). The API enforces the format and the server validates it again.
3. `instructionsToSpec()` turns the instructions into camera settings: numbers are clamped, and when
   **Show Entire Photo** is on the photo is always drawn whole. Anything in the request that conflicts
   (filling the screen, an orbit on a flat photo) is shown to the person, never silently dropped.
4. The cost of the Claude call is written by the server into the AI usage log (Admin → AI control panel)
   and counts toward the monthly and daily AI spending ceilings.

Without Claude (switched off, no key, a limit reached or an error) a free keyword reader answers instead,
and the panel says **Basic understanding** and why.

## Honest limits

- Standard moves animate the original photo. With Show Entire Photo on, every corner of the photo stays in
  the frame for the whole clip; a big move is scaled down rather than cropping.
- A flat photo can't truly orbit, arc, show parallax or fly like a drone. In Standard these are labelled
  *2D stand-ins*; the real versions need an AI method.
- AI clips (depth or generative) fill the frame, so they can't keep the whole photo visible, and
  generative clips can change details. Each AI clip is reviewed against the photo before it's used.
- Applying from a scene changes that scene's camera; the video's shape is set in the editor. Opened from
  a photo (not a scene), **Apply** saves the movement on the photo for new videos of the listing.

## Files

- `apps/web/src/lib/camera/ai-camera.ts`: instructions schema, presets, keyword reader, `instructionsToSpec`
- `apps/web/src/lib/camera/ai-camera-claude.ts`: the Claude request and answer reading (server only)
- `apps/web/src/lib/camera/ai-camera-store.ts`: permission checks, Claude call, cost recording
- `apps/web/src/app/api/camera/interpret/route.ts`: `POST /api/camera/interpret`
- `apps/web/src/app/(app)/camera-studio/ai-camera-panel.tsx`: the panel
- `supabase/migrations/20261116000100_ai_camera_control.sql`: usage log, ceilings, `start_camera_prompt`

## Updating a live database

Run `supabase/migrations/20261116000100_ai_camera_control.sql` in the Supabase SQL Editor (or
`npx supabase db push`). New installs get it from `supabase/setup.sql`.
