/*
 * STAGE 11 ACCEPTANCE — Real estate templates and brand kit.
 *
 *  "Select a listing. Apply a Just Listed template. Confirm property information and agent
 *   branding are inserted automatically. Render and download the final video."
 *
 *  The database is the real one (every migration, on PGlite) with its row-level security:
 *   1. The Super Admin sets up the brand kit (logos, colours, intro/outro, agent layout,
 *      required disclosure); an administrator enforces branding rules and creates the
 *      agent profile with a headshot; the server adds the company's built-in templates.
 *   2. An agent (editor) creates a listing with 20 photos and assigns the agent profile.
 *   3. As that agent: select the listing, see the recommendation, pick the approved
 *      Just Listed template, and apply it with the same code the app runs (templateListing,
 *      agentFrom, templateBrandFrom, buildTemplatePlan, applyBrandRules, composeDocument).
 *   4. Check that the listing's facts and the agent's branding were inserted without typing
 *      anything: address, price, beds/baths/size, JUST LISTED, agent name, phone, email,
 *      brokerage, headshot, brokerage logo, company logo and the disclosure.
 *   5. The project and its render job are saved as the agent (RLS), the real render worker
 *      renders it, the MP4 is stored, and the agent downloads it (storage RLS) — a viewer
 *      who isn't on the listing can't.
 *   6. The downloaded MP4 is checked: 1080×1920, length, H.264 + AAC music, clean decode,
 *      plays in Chrome, and frames show the intro bar, the banner, the agent card with the
 *      headshot, and the disclosure strip.
 *
 * Run with: LVS_RENDER_TESTS=1 npx vitest run tests/render/templates.acceptance.test.ts
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allowedAssetsFor, processJob, probe, type AssetRow } from "@lvs/render-worker";
import { company, freshDatabase, rejects, server, signedIn } from "../db/helpers";
import { contactStrip, makeFixtures, workerDeps, type Asset } from "./template-fixtures";
import {
  applyBrandRules, agentFrom, builtinTemplateRows, buildTemplatePlan, factsFrom, recommendTemplate, rulesFrom, templateBrandFrom, templateListing, templateSpecSchema,
} from "@/lib/video/templates";
import { brandWindows } from "@/lib/video/brand-layers";
import { composeDocument, totalDuration, type PlanLogo, type PlanPhoto } from "@/lib/video/plan";
import { validateFableCutDocument } from "@/lib/video/validate-document";
import type { AgentProfileRow, BrandKitRow, ListingRow } from "@/lib/database.types";

const hasTools = spawnSync("ffmpeg", ["-version"]).status === 0 && existsSync("/usr/bin/google-chrome");
process.env.LVS_CHROME_BIN ??= process.env.LVS_TEST_CHROME ?? "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const OUT = join(__dirname, "..", "..", "test-output", "stage11");
const MUSIC = join(__dirname, "..", "..", "assets", "music", "bright-open-house.m4a");

/** Average colour of a box in a frame of the MP4 (x, y, w, h in output pixels). */
function boxColor(file: string, t: number, x: number, y: number, w: number, h: number): [number, number, number] {
  const r = spawnSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", `crop=${w}:${h}:${x}:${y},scale=1:1:flags=area`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 16 });
  const b = r.stdout as Buffer;
  return [b[0]!, b[1]!, b[2]!];
}
const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const near = (a: number[], b: number[], tol: number) => a.every((v, i) => Math.abs(v - b[i]!) <= tol);

describe.skipIf(!hasTools)("Stage 11 acceptance: Just Listed template on a real listing → agent branding → render → download", () => {
  const ctx = {} as {
    db: Awaited<ReturnType<typeof freshDatabase>>; org: string; ids: Record<string, string>; listingId: string; projectId: string; jobId: string;
    fx: ReturnType<typeof makeFixtures>; music: Asset; file: string; plan: ReturnType<typeof buildTemplatePlan>["plan"]; doc: Record<string, unknown>;
  };

  it("sets up the company: brand kit (Super Admin), branding rules and agent profile (administrator), built-in templates (server)", async () => {
    mkdirSync(OUT, { recursive: true });
    ctx.db = await freshDatabase();
    const c = await company(ctx.db, { adam: "admin", alice: "editor", vera: "viewer" });
    ctx.org = c.org; ctx.ids = c.ids;
    const owner = signedIn(ctx.db, c.ids.superAdmin!), adam = signedIn(ctx.db, c.ids.adam!), worker = server(ctx.db);
    ctx.listingId = randomUUID();
    ctx.fx = makeFixtures(ctx.org, ctx.listingId, OUT);
    const { logo, brokerage, headshot } = ctx.fx;

    // brand images are registered by the server with their real size (ensureBrandImage)
    for (const a of [logo, brokerage]) {
      await worker((tx) => tx.query(`insert into public.media_assets (id, organization_id, kind, bucket, storage_path, file_name, mime_type, size_bytes, width, height)
        values ($1, $2, 'logo', 'brand-assets', $3, 'logo.png', 'image/png', 1, $4, $5)`, [a.row.id, ctx.org, a.row.storage_path, a.width, a.height]));
    }
    // the brand kit is the Super Admin's; an administrator can't change it
    expect((await adam((tx) => tx.query(`update public.brand_kits set company_name = 'X' returning 1`))).rows).toHaveLength(0);
    await owner((tx) => tx.query(`update public.brand_kits set company_name = 'Acme Realty', brokerage_name = 'Acme Realty Brokers', brokerage_license = 'Broker Lic. #778899',
      primary_color = '#1D4ED8', secondary_color = '#0F172A', accent_color = '#F59E0B', heading_font = 'Montserrat', body_font = 'Inter',
      logo_path = $1, brokerage_logo_path = $2, intro_style = 'logo-reveal', outro_style = 'agent-card', agent_layout = 'photo-left',
      disclaimer = 'Acme Realty Brokers. Equal Housing Opportunity. Information deemed reliable but not guaranteed.', disclosure_required = true`,
      [logo.row.storage_path, brokerage.row.storage_path]));
    // administrator: rules every video must follow
    await adam((tx) => tx.query(`select public.admin_set_brand_rules(true, true, true, false, false)`));
    // administrator: agent profile with headshot, linked to Alice
    await adam((tx) => tx.query(`insert into public.media_assets (id, organization_id, uploaded_by, kind, bucket, storage_path, file_name, mime_type, size_bytes, width, height)
      values ($1, $2, auth.uid(), 'headshot', 'brand-assets', $3, 'alice.jpg', 'image/jpeg', 100, 600, 800)`, [headshot.row.id, ctx.org, headshot.row.storage_path]));
    await adam((tx) => tx.query(`insert into public.agent_profiles (organization_id, user_id, name, title, phone, email, license, headshot_asset_id, created_by)
      values ($1, $2, 'Alice Agent', 'Listing Agent', '555-0100', 'alice@acme.test', 'Lic. #01234567', $3, auth.uid())`, [ctx.org, c.ids.alice, headshot.row.id]));
    // the server adds the company's built-in templates (ensureOrgTemplates)
    for (const r of builtinTemplateRows(ctx.org)) {
      await worker((tx) => tx.query(`insert into public.video_templates (organization_id, slug, builtin_key, name, description, usage, aspect_ratios, style, status, sort_order)
        values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`, [r.organization_id, r.slug, r.builtin_key, r.name, r.description, r.usage, r.aspect_ratios, JSON.stringify(r.style), r.status, r.sort_order]));
    }
    // licensed music (the built-in original track, verified)
    const musicId = randomUUID();
    ctx.music = { file: MUSIC, width: 0, height: 0, row: { id: musicId, organization_id: ctx.org, listing_id: null, project_id: null, kind: "audio", bucket: "music-library", storage_path: `${ctx.org}/music/${musicId}.m4a` } };
    await worker((tx) => tx.query(`insert into public.media_assets (id, organization_id, kind, bucket, storage_path, file_name, mime_type, size_bytes, duration_seconds)
      values ($1, $2, 'audio', 'music-library', $3, 'bright-open-house.m4a', 'audio/mp4', 1, 75)`, [musicId, ctx.org, ctx.music.row.storage_path]));
    await worker((tx) => tx.query(`insert into public.music_tracks (organization_id, asset_id, title, mood, license_type, license_details, commercial_use_verified, verified_at, builtin_key)
      values ($1, $2, 'Bright Open House', 'upbeat', 'original_builtin', 'Original music generated by the app', true, now(), 'bright-open-house')`, [ctx.org, musicId]));
  });

  it("the agent creates the listing with 20 photos and assigns their agent profile", async () => {
    const alice = signedIn(ctx.db, ctx.ids.alice!);
    const agent = (await alice((tx) => tx.query<{ id: string }>(`select id from public.agent_profiles where user_id = auth.uid()`))).rows[0]!.id;
    await alice((tx) => tx.query(`insert into public.listings (id, organization_id, created_by, address_line, city, state, postal_code, price, bedrooms, bathrooms, square_feet,
      property_type, description, mls_number, status, agent_profile_id)
      values ($1, $2, auth.uid(), '742 Evergreen Terrace', 'Springfield', 'OR', '97403', 525000, 4, 2.5, 2150, 'single_family',
      'Bright, updated home with a big kitchen and a fenced yard.', 'OR-22-1234', 'for_sale', $3)`, [ctx.listingId, ctx.org, agent]));
    for (const [i, p] of ctx.fx.photos.entries()) {
      await alice((tx) => tx.query(`insert into public.media_assets (id, organization_id, listing_id, uploaded_by, kind, bucket, storage_path, file_name, mime_type, size_bytes, width, height, sort_order)
        values ($1, $2, $3, auth.uid(), 'photo', 'listing-media', $4, $5, 'image/jpeg', 1000, $6, $7, $8)`, [p.row.id, ctx.org, ctx.listingId, p.row.storage_path, `photo-${i + 1}.jpg`, p.width, p.height, i]));
    }
    await alice((tx) => tx.query(`update public.listings set cover_asset_id = $1 where id = $2`, [ctx.fx.photos[0]!.row.id, ctx.listingId]));
  });

  it("select the listing, apply the Just Listed template: property facts and agent branding are filled in automatically", async () => {
    const alice = signedIn(ctx.db, ctx.ids.alice!);
    const q = <T,>(sql: string, args: unknown[] = []) => alice((tx) => tx.query<T>(sql, args)).then((r) => r.rows);
    // what the app loads, as Alice (RLS applies)
    const [listing] = await q<ListingRow>(`select * from public.listings where id = $1`, [ctx.listingId]);
    const templates = await q<{ id: string; builtin_key: string; status: string; style: unknown }>(`select id, builtin_key, status, style from public.video_templates order by sort_order`);
    const [kit] = await q<BrandKitRow>(`select * from public.brand_kits`);
    const [rules] = await q<{ r: unknown }>(`select public.my_brand_rules() r`);
    const [profile] = await q<AgentProfileRow>(`select * from public.agent_profiles where id = $1`, [listing!.agent_profile_id]);
    const photos = await q<PlanPhoto>(`select id, storage_path, file_name, width, height from public.media_assets where listing_id = $1 and kind = 'photo' order by sort_order`, [ctx.listingId]);
    const brandImages = await q<PlanLogo>(`select id, storage_path, width, height from public.media_assets where bucket = 'brand-assets' and kind in ('logo', 'headshot')`);
    const music = await q<{ id: string; storage_path: string; file_name: string; duration_seconds: string }>(`select m.id, m.storage_path, m.file_name, m.duration_seconds from public.music_tracks t join public.media_assets m on m.id = t.asset_id where t.commercial_use_verified`);
    expect(templates).toHaveLength(15);
    expect(templates.every((t) => t.status === "approved")).toBe(true);

    // the recommendation for a brand-new listing is Just Listed
    const rec = recommendTemplate(templateListing(listing!));
    expect(rec.key).toBe("just-listed");
    const justListed = templates.find((t) => t.builtin_key === "just-listed")!;
    const spec = templateSpecSchema.parse(justListed.style);

    const logo = brandImages.find((b) => b.storage_path === kit!.logo_path)!;
    const brokerageLogo = brandImages.find((b) => b.storage_path === kit!.brokerage_logo_path)!;
    const brand = templateBrandFrom(kit!, "Acme Realty", logo.id, brokerageLogo.id);
    const agent = agentFrom(profile!, listing!, kit!, profile!.headshot_asset_id);
    const r = rulesFrom(rules!.r);
    const built = buildTemplatePlan({ spec, listing: templateListing(listing!), photos, brand, agent, rules: r, musicAssetId: music[0]!.id });
    const { plan } = applyBrandRules(built.plan, r, factsFrom(brand, agent));
    expect(built.warnings).toEqual([]);
    ctx.plan = plan;

    // property information — straight from the listing, nothing typed
    const words = plan.texts.map((t) => t.text).join(" | ");
    for (const w of ["Just Listed", "742 Evergreen Terrace", "Springfield, OR", "$525,000", "4 beds", "2.5 baths", "2,150 sq ft", "Book your private showing"]) expect(words, w).toContain(w);
    // agent branding — from the assigned agent profile and the brand kit
    expect(plan.branding?.agent).toMatchObject({ name: "Alice Agent", title: "Listing Agent", phone: "555-0100", email: "alice@acme.test", brokerage: "Acme Realty Brokers", license: "Lic. #01234567", headshotAssetId: ctx.fx.headshot.row.id });
    expect(plan.branding?.outro.style).toBe("agent-card");
    expect(plan.branding?.intro.style).toBe("bar-wipe"); // the template's own intro
    expect(plan.branding?.brokerageLogoAssetId).toBe(brokerageLogo.id);
    expect(plan.branding?.disclosure).toMatch(/Equal Housing Opportunity/);
    expect(plan.logoAssetId).toBe(logo.id);
    expect(plan.aspect).toBe("9:16");

    const doc = composeDocument({
      plan, title: "Just Listed — 742 Evergreen Terrace", photos, music: music.map((m) => ({ ...m, duration_seconds: Number(m.duration_seconds) })),
      brand: { primary_color: kit!.primary_color, heading_font: kit!.heading_font, body_font: kit!.body_font }, logo, brandImages,
    });
    expect(validateFableCutDocument(doc)).toEqual({ ok: true });
    const clips = doc.clips as { id: string; props: Record<string, unknown> }[];
    const agentText = clips.filter((c) => c.id.startsWith("c_brand_agent_")).map((c) => String(c.props.text)).join(" | ");
    for (const w of ["ALICE AGENT", "Listing Agent", "Acme Realty Brokers", "555-0100", "alice@acme.test"]) expect(agentText, w).toContain(w);
    expect(clips.some((c) => c.id === "c_brand_headshot")).toBe(true);
    ctx.doc = doc;

    // saved as Alice: the project and its render job (RLS)
    ctx.projectId = (await alice((tx) => tx.query<{ id: string }>(`insert into public.video_projects (organization_id, listing_id, template_id, created_by, title, aspect_ratios, edit_plan, document, revision)
      values ($1, $2, $3, auth.uid(), 'Just Listed — 742 Evergreen Terrace', '{9:16}', $4, $5, 1) returning id`, [ctx.org, ctx.listingId, justListed.id, JSON.stringify(plan), JSON.stringify(doc)]))).rows[0]!.id;
    ctx.jobId = (await alice((tx) => tx.query<{ id: string }>(`insert into public.render_jobs (organization_id, project_id, revision, preset, aspect, document, requested_by, label)
      values ($1, $2, 1, 'master-1080p', '9:16', $3, auth.uid(), 'Just Listed') returning id`, [ctx.org, ctx.projectId, JSON.stringify(doc)]))).rows[0]!.id;
  });

  it("renders the final video in the background worker and the agent downloads it", async () => {
    const worker = server(ctx.db);
    // the worker only gets files the project may use (the same check as in production)
    const rows = (await worker((tx) => tx.query<AssetRow>(`select id, organization_id, listing_id, project_id, kind::text, bucket, storage_path from public.media_assets where organization_id = $1`, [ctx.org]))).rows;
    const allowed = allowedAssetsFor({ id: ctx.projectId, organization_id: ctx.org, listing_id: ctx.listingId, title: "x" }, rows);
    expect(allowed.some((a) => a.id === ctx.fx.headshot.row.id)).toBe(true);
    const all = [...ctx.fx.photos, ctx.fx.logo, ctx.fx.brokerage, ctx.fx.headshot, ctx.music];
    const stored = new Map<string, Uint8Array>();
    const deps = workerDeps(ctx.org, ctx.listingId, ctx.projectId, all, stored);
    deps.loadAssets = async (ids) => rows.filter((r) => ids.includes(r.id));
    const r = await processJob({ id: ctx.jobId, organization_id: ctx.org, project_id: ctx.projectId, aspect: "9:16", document: ctx.doc }, deps);
    expect(r.error ?? "").toBe("");
    const outputPath = `${ctx.org}/projects/${ctx.projectId}/${ctx.jobId}.mp4`;
    await worker((tx) => tx.query(`insert into storage.objects (bucket_id, name) values ('video-exports', $1)`, [outputPath]));
    await worker((tx) => tx.query(`update public.render_jobs set status = 'succeeded', progress = 1, output_path = $1 where id = $2`, [outputPath, ctx.jobId]));

    // download: the agent sees the file (storage RLS: can download + can read the project); a viewer not on the listing doesn't
    const alice = signedIn(ctx.db, ctx.ids.alice!), vera = signedIn(ctx.db, ctx.ids.vera!);
    expect((await alice((tx) => tx.query(`select name from storage.objects where bucket_id = 'video-exports' and name = $1`, [outputPath]))).rows).toHaveLength(1);
    expect((await vera((tx) => tx.query(`select name from storage.objects where bucket_id = 'video-exports' and name = $1`, [outputPath]))).rows).toHaveLength(0);
    await rejects(vera((tx) => tx.query(`insert into public.render_jobs (organization_id, project_id, revision, preset, aspect, document, requested_by) values ($1, $2, 1, 'x', '9:16', '{}', auth.uid())`, [ctx.org, ctx.projectId])));
    ctx.file = join(OUT, "just-listed-742-evergreen-terrace.mp4");
    writeFileSync(ctx.file, [...stored.values()][0]!);
  }, 900_000);

  it("the downloaded MP4 is a real, playable vertical 1080p video with music", () => {
    const p = probe(ctx.file);
    expect([p.width, p.height]).toEqual([1080, 1920]);
    expect(Math.abs(p.durationSeconds - totalDuration(ctx.plan))).toBeLessThan(0.6);
    const codec = (s: string) => spawnSync("ffprobe", ["-v", "error", "-select_streams", s, "-show_entries", "stream=codec_name", "-of", "csv=p=0", ctx.file], { encoding: "utf8" }).stdout.trim();
    expect(codec("v:0")).toBe("h264");
    expect(codec("a:0")).toBe("aac");
    const vol = spawnSync("ffmpeg", ["-v", "info", "-i", ctx.file, "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" }).stderr;
    expect(Number(/mean_volume: (-?[\d.]+) dB/.exec(vol)?.[1] ?? "-99")).toBeGreaterThan(-35);
    expect(spawnSync("ffmpeg", ["-v", "error", "-i", ctx.file, "-f", "null", "-"], { encoding: "utf8" }).stderr.trim()).toBe("");
    contactStrip(ctx.file, join(OUT, "just-listed-strip.jpg"), totalDuration(ctx.plan), 8);
  });

  it("the frames show the branding: intro bar, banner, agent card with headshot, disclosure", () => {
    const w = brandWindows(ctx.plan);
    const primary = hex("#1D4ED8"), panel = hex("#0F172A");
    // intro: the brand-colour bar across the middle while the bar wipe holds
    expect(near(boxColor(ctx.file, 0.9, 60, 940, 200, 30), primary, 40), "intro bar").toBe(true);
    // outro: the panel covers the frame; the headshot sits in the circle above the name (centred layout on tall videos)
    const t = w.outro![0] + 1.4;
    expect(near(boxColor(ctx.file, t, 30, 120, 120, 120), panel, 30), "outro panel").toBe(true);
    const face = boxColor(ctx.file, t, 520, 960 - 259 - 20, 40, 40);
    expect(near(face, hex("#e0b48c"), 45), `headshot ${face}`).toBe(true);
    // disclosure: the dark strip at the bottom of the last scene, with light text in it
    const strip = spawnSync("ffmpeg", ["-v", "error", "-ss", String(w.lastStart + 0.3), "-i", ctx.file, "-frames:v", "1", "-vf", "crop=1000:60:40:1800,format=gray", "-f", "rawvideo", "-"], { maxBuffer: 1 << 20 }).stdout as Buffer;
    expect(Math.max(...strip), "disclosure text").toBeGreaterThan(180);
    for (const [name, at] of [["intro", 0.9], ["banner", w.intro![1] + 0.8], ["agent-card", t]] as const) {
      spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", String(at), "-i", ctx.file, "-frames:v", "1", "-vf", "scale=540:-2", join(OUT, `frame-${name}.jpg`)]);
    }
  });

  it("plays in Chrome", async () => {
    type Page = { goto(u: string): Promise<unknown>; evaluate<T>(fn: () => Promise<T>): Promise<T> };
    const { chromium } = createRequire(import.meta.url)("playwright") as { chromium: { launch(o: object): Promise<{ newPage(): Promise<Page>; close(): Promise<void> }> } };
    const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
    try {
      const page = await browser.newPage();
      const html = join(OUT, "player.html");
      writeFileSync(html, `<!doctype html><video src="${ctx.file.split("/").pop()}" muted playsinline></video>`);
      await page.goto(`file://${html}`);
      const res = await page.evaluate(async () => { const v = document.querySelector("video")!; await v.play(); await new Promise((r) => setTimeout(r, 1500)); return { w: v.videoWidth, time: v.currentTime, err: v.error?.message ?? null }; });
      expect(res.err).toBeNull();
      expect(res.w).toBe(1080);
      expect(res.time).toBeGreaterThan(0.8);
    } finally { await browser.close(); }
    expect(readFileSync(ctx.file).length).toBeGreaterThan(100_000);
  }, 120_000);
});
