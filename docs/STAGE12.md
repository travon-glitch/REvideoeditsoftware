# Stage 12 — Advanced editor, AI voiceovers and captions

The video editor now has two modes in the same page (`/videos/[id]/edit`): **Easy** and **Advanced**. The tab you pick is remembered with `?mode=`, and otherwise follows the person's own setting (`ui_mode`). Both modes edit the same saved plan. Autosave and undo/redo work in both.

## Easy editor (`easy-editor.tsx`)
One screen, with large buttons:
- **Preview**, with play/pause and a scrubber.
- **Photo order**: drag, or use the arrow buttons, to reorder; remove or re-add photos.
- **Change Style**, **Change Music**, **Add Text**, **Camera Movement** (the Stage 10 Camera Studio).
- **Generate** sends the video to the render worker. **Download** appears when a render finishes, if the person may download.

## Advanced editor (`video-editor.tsx`, `timeline.tsx`, `inspector.tsx`)
- **Multitrack timeline**:
  - tracks for scenes, text, overlays, captions, voice and music;
  - a ruler and a playhead you can drag;
  - drag to move; drag either edge to trim; drag scenes to reorder.
- **Split** (S key) at the playhead, **trim**, **duplicate scene**, **delete** (Delete key), **undo / redo** (toolbar buttons and the usual shortcuts).
- **Keyframes** on text and overlays: position, scale, rotation and opacity, with easing.
- **Image positioning**: pan (x/y), zoom and rotation per scene, for stills and as a camera start point.
- **Text positioning**: x/y on the frame, plus animation in and out.
- **Animated overlays**: lower-third bar, round badge, pointing arrow, frame border, drawn underline, sparkle, SOLD stamp and price tag, each with its own in/out animation and keyframes.
- **Transition controls**: per-scene transition type and length. The diamond marker on the timeline opens them.
- **AI clip insertion**: insert any finished AI clip (Stage 9) at the playhead. Clips marked as having a problem are not offered.
- **Scene segment**: use only part of a camera move or AI clip (`segment.from/to`, `clipIn`).
- **Inspector tabs**: Selected, Voice, Captions, Music, Video.

## AI voiceovers (`packages/voice`, `lib/video/voice-store.ts`)
- **Voice engine:** Kokoro-82M v1.0 (Apache-2.0) through sherpa-onnx-node (Apache-2.0). It runs **on the app server**, so no listing text or audio is sent to any outside service and no API key is needed.
- **10 English voices**, US and UK, female and male. You can **preview** each one before using it.
- **Speed** from 0.7× to 1.3×, a pause between sentences, **volume**, and **start time** on the timeline.
- **Narration script:**
  - **Draft from listing** (`narration.ts`) writes a script only from verified listing fields, such as address, price, beds/baths/size, features and the agent. It never makes up facts. Fields that are missing are left out.
  - The script can be edited freely. **Check facts** runs the Stage 6 claim checker against the listing and warns about any number or claim the listing doesn't support. Narration is also checked again when it is generated.
  - Addresses, prices, square feet, states and abbreviations are spoken properly, for example "$1,250,000" becomes "one million two hundred fifty thousand dollars". Words the voice doesn't know are reported.
- The voice is stored as AAC in `project-media`, as its own `media_assets` row tied to the project. Saving a plan checks that its voiceover belongs to the same project.
- **Recorded narration:** a person can upload their own recording instead.
- **Ducking:** music is lowered automatically while the narration plays.

## Subtitles
- **Automatic transcription:**
  - Zipformer small English (Apache-2.0) speech recognition, also on the server.
  - For AI narration, the recognised words are aligned to the written script, so the captions are spelled correctly and timed to the audio.
  - For recorded narration or uploaded audio, the recognised words are used directly.
- **Editing:** change the text and start/end time of each caption line, delete lines, or add new ones. A timing slider moves all captions earlier or later (±2 s).
- **Animated captions and styles**, using FableCut word timing: subtitles on a bar, karaoke (words light up), bold highlight (social) and word pop.
- **Position** (top, middle, bottom) and **size**.

## Music
- **Upload** now requires the person to confirm that they are licensed or authorized to use the track, and to give the purpose. That confirmation is recorded in the audit log by `record_audio_authorization`. The Easy Mode wizard asks the same.
- Licensed library tracks from Stage 5 are still available.
- Controls:
  - volume;
  - fade in and fade out;
  - trim (start point inside the track);
  - where it starts and ends in the video;
  - ducking under narration.

## Export
**Vertical 9:16, Wide 16:9, Square 1:1 and the new Portrait 4:5 (1080×1350).** Each one is a real H.264 + AAC MP4 from the render worker. Several shapes can be queued at once from the Video tab. The database allows 4:5 for render jobs and batches.

## Database (`supabase/migrations/20261112000100_editor_voice.sql`)
- `render_jobs` and `video_batches` aspect checks now include `4:5`.
- `record_audio_authorization(asset, purpose)` is a security-definer function. It checks that the caller may edit the asset's project, then writes the audit entry. People can't write to the audit log directly.

## Licences
Both voice models and the runtime are Apache-2.0. See `THIRD_PARTY_NOTICES.md`. The models aren't stored in git. They are downloaded once with:

```bash
npm run fetch-models -w @lvs/voice
```

See `SETUP.md` §8b. The editor shows a notice until the models are installed.

## Tests
- `packages/voice`: 6 tests. They cover:
  - speakable numbers and addresses;
  - synthesis;
  - transcription;
  - alignment;
  - cue building.
- `src/lib/__tests__/editor-stage12.test.ts`: 10 tests. They cover:
  - split, trim, duplicate and AI-clip insertion;
  - keyframes, overlays and captions in the FableCut document;
  - music fades and ducking;
  - 4:5;
  - narration drafting and fact-checking.
- `tests/db/editor-voice.test.ts`: 2 tests. They cover the 4:5 renders and the music authorization audit, with RLS.
- **Acceptance** (`tests/render/editor.acceptance.test.ts`), run from `apps/web` with:

  ```bash
  LVS_RENDER_TESTS=1 npx vitest run tests/render/editor.acceptance.test.ts
  ```

  The test does the following:
  - builds a project with several photos, camera moves, text, licensed music, AI narration drafted from the listing, and animated captions;
  - renders it in 9:16 and 16:9 with the real worker;
  - checks that each scene shows its photo at the right time;
  - transcribes the rendered MP4's own audio and compares each word's time with the planned caption time;
  - checks that captions are highlighted while their words are spoken.

**Results (2026-11-03):**
- Acceptance: **7/7 passed.**
- **A/V sync:**
  - 35 of 35 narrated words were found in the rendered audio.
  - The mean offset between a word being heard and its caption was **0.063 s**. The median was **0.02 s**, and 90% were within **0.02 s**.
  - Every scene matched its photo. Both shapes play in Chrome.
- Web unit and database tests: **234/234.** Camera engine: **21/21.** AI motion: **8/8.** Voice: **6/6.**
- Typecheck and production build pass.
- Screenshots:
  - `docs/screenshots/stage12-easy.png`;
  - `stage12-advanced.png`;
  - `stage12-voice.png`;
  - `stage12-captions.png`;
  - `stage12-music.png`;
  - `stage12-rendered-frames.jpg`.

**Not covered here:**
- The editor screens were checked with sample data in a test page, not against a live Supabase project.
- Voices and captions are English only.
- Speech recognition of recorded narration is less accurate with background noise, so its captions should be reviewed before export.
