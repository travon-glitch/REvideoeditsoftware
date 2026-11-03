/*
 * Branding layers drawn on top of a plan's scenes (Stage 11):
 *   - intro animation over the start of the first scene (logo reveal, bar wipe or title card),
 *   - outro over the end of the last scene (agent card with headshot, logo end card or contact bar),
 *   - the required brokerage disclosure on the last scene.
 * Everything is ordinary FableCut clips (shape layers, images, text) with keyframes, so preview
 * tools, the validator and the renderer treat them like any other clip.
 */
import type { EditPlan, PlanLook } from "./plan";
import { mediaIdFor } from "./plan";

export interface BrandImage { id: string; storage_path: string; width: number | null; height: number | null }
type Clip = Record<string, unknown>;
type Key = { t: number; v: number; ease?: string };

const r = (n: number) => Math.round(n * 1000) / 1000;
const DEFAULT_LOOK: Pick<PlanLook, "headingFont" | "bodyFont" | "accent" | "panel" | "text" | "letterSpacing" | "uppercase"> = {
  headingFont: "Montserrat", bodyFont: "Inter", accent: "#1D4ED8", panel: "#0F172A", text: "#FFFFFF", letterSpacing: 0, uppercase: false,
};

/** Where the intro and outro sit (seconds), clamped to the first / last scene. */
export function brandWindows(plan: Pick<EditPlan, "scenes" | "branding">): { intro: [number, number] | null; outro: [number, number] | null; lastStart: number; total: number } {
  const total = r(plan.scenes.reduce((s, x) => s + x.duration, 0));
  const first = plan.scenes[0]?.duration ?? 0;
  const last = plan.scenes.at(-1)?.duration ?? 0;
  const lastStart = r(total - last);
  const b = plan.branding;
  const intro = b && b.intro.style !== "none" ? [0, r(Math.min(b.intro.seconds, first))] as [number, number] : null;
  const outroLen = b && b.outro.style !== "none" ? r(Math.min(b.outro.seconds, last)) : 0;
  const outro = outroLen > 0 ? [r(total - outroLen), total] as [number, number] : null;
  return { intro, outro, lastStart, total };
}

/** The clips for the plan's branding (empty when the plan has none). */
export function brandLayerClips(input: {
  plan: EditPlan;
  canvas: { width: number; height: number };
  images: Map<string, BrandImage>;
  brandColor: string;
}): Clip[] {
  const { plan, canvas, images } = input;
  const b = plan.branding;
  if (!b) return [];
  const look = { ...DEFAULT_LOOK, accent: input.brandColor, ...(plan.look ?? {}) };
  const W = canvas.width, H = canvas.height, short = Math.min(W, H), wide = W > H;
  const win = brandWindows(plan);
  const out: Clip[] = [];
  const logo = b.logoAssetId ? images.get(b.logoAssetId) ?? null : null;
  const brokerageLogo = b.brokerageLogoAssetId ? images.get(b.brokerageLogoAssetId) ?? null : null;
  const headshot = b.agent?.headshotAssetId ? images.get(b.agent.headshotAssetId) ?? null : null;
  const caps = (s: string) => (look.uppercase ? s.toUpperCase() : s);

  const text = (id: string, track: string, start: number, duration: number, props: Record<string, unknown>, keyframes?: Record<string, Key[]>): Clip => ({
    id, mediaId: null, kind: "text", track, start: r(start), in: 0, duration: r(Math.max(0.3, duration)), name: String(props.text).split("\n")[0]!.slice(0, 40),
    props: { font: look.bodyFont, color: look.text, bold: false, align: "center", textShadow: 0, boxW: Math.round(W * 0.84), boxH: Math.round(short * 0.12), boxFit: true, vAlign: "middle", ...props },
    ...(keyframes ? { keyframes } : {}),
  });
  const panel = (id: string, start: number, duration: number, fill: string, opacity: number, keyframes?: Record<string, Key[]>, w = W, h = H, y = 0): Clip => ({
    id, mediaId: null, kind: "shape", track: "V6", start: r(start), in: 0, duration: r(duration), name: "Panel",
    props: { y, opacity, shapes: [{ type: "rect", name: "Panel", w, h, fill }] },
    ...(keyframes ? { keyframes } : {}),
  });
  /** An image fitted inside a box (bw × bh px), centred at x, y. */
  const image = (id: string, img: BrandImage, start: number, duration: number, bw: number, bh: number, x: number, y: number, keyframes?: Record<string, Key[]>, extra: Record<string, unknown> = {}): Clip => {
    const iw = img.width || 1, ih = img.height || 1;
    const f = Math.min(W / iw, H / ih);
    const scale = r(Math.min(bw / (iw * f), bh / (ih * f)));
    return {
      id, mediaId: mediaIdFor(img.id), kind: "image", track: "V7", start: r(start), in: 0, duration: r(duration), name: id,
      props: { fit: "contain", scale, x: r(x), y: r(y), ...extra }, ...(keyframes ? { keyframes } : {}),
    };
  };
  /** A round headshot: the photo cropped square, then clipped to a circle of `size` px. */
  const portrait = (img: BrandImage, start: number, duration: number, size: number, x: number, y: number): Clip[] => {
    const iw = img.width || 1, ih = img.height || 1;
    const crop = ih > iw ? { cropT: r(((ih - iw) / ih) * 50), cropB: r(((ih - iw) / ih) * 50) } : { cropL: r(((iw - ih) / iw) * 50), cropR: r(((iw - ih) / iw) * 50) };
    const scale = r(size / short);
    return [
      { id: "c_brand_headshot_ring", mediaId: null, kind: "shape", track: "V7", start: r(start), in: 0, duration: r(duration), name: "Ring",
        props: { x: r(x), y: r(y), shapes: [{ type: "ellipse", w: Math.round(size + short * 0.016), h: Math.round(size + short * 0.016), fill: look.accent }] },
        keyframes: { scale: [{ t: 0, v: 0.6 }, { t: 0.45, v: 1, ease: "ease-out" }], opacity: [{ t: 0, v: 0 }, { t: 0.3, v: 1 }] } },
      { id: "c_brand_headshot", mediaId: mediaIdFor(img.id), kind: "image", track: "V8", start: r(start), in: 0, duration: r(duration), name: "Headshot",
        props: { fit: "contain", scale, x: r(x), y: r(y), cornerRadius: Math.round(size / 2), ...crop },
        keyframes: { scale: [{ t: 0, v: scale * 0.6 }, { t: 0.45, v: scale, ease: "ease-out" }], opacity: [{ t: 0, v: 0 }, { t: 0.3, v: 1 }] } },
    ];
  };

  /* ── Intro ── */
  if (win.intro) {
    const [s0, s1] = win.intro;
    const d = s1 - s0, exit = Math.max(0.4, d - 0.45);
    const name = b.companyName ?? "";
    const style = b.intro.style;
    if (style === "logo-reveal" || style === "title-card") {
      // full panel; slides up (logo reveal) or fades (title card) to reveal the first photo
      const leave: Record<string, Key[]> = style === "logo-reveal"
        ? { y: [{ t: 0, v: 0 }, { t: r(exit), v: 0 }, { t: r(d), v: -H, ease: "ease-in" }] }
        : { opacity: [{ t: 0, v: 1 }, { t: r(exit), v: 1 }, { t: r(d), v: 0 }] };
      out.push(panel("c_brand_intro_panel", s0, d, look.panel, 1, leave));
      const follow = (k: Record<string, Key[]>, baseY: number): Record<string, Key[]> => ({ ...k, ...(style === "logo-reveal" ? { y: leave.y!.map((x) => ({ ...x, v: x.v + baseY })) } : {}) });
      const fadeOut: Key[] = style === "title-card" ? [{ t: 0, v: 0 }, { t: 0.35, v: 1 }, { t: r(exit), v: 1 }, { t: r(d), v: 0 }] : [{ t: 0, v: 0 }, { t: 0.35, v: 1 }];
      if (style === "title-card") {
        const title = caps(b.intro.title || name);
        if (title) out.push(text("c_brand_intro_title", "V8", s0, d, {
          text: title, font: look.headingFont, bold: true, fontSize: Math.round(short * 0.1), letterSpacing: look.letterSpacing,
          y: -Math.round(short * 0.04), textAnim: "clip-reveal", boxH: Math.round(short * 0.24),
        }, { opacity: fadeOut }));
        out.push({ id: "c_brand_intro_rule", mediaId: null, kind: "shape", track: "V7", start: r(s0 + 0.25), in: 0, duration: r(d - 0.25), name: "Rule",
          props: { y: Math.round(short * 0.1), shapes: [{ type: "line", points: [[-Math.round(W * 0.2), 0], [Math.round(W * 0.2), 0]], stroke: look.accent, strokeWidth: Math.max(4, Math.round(short * 0.008)),
            keys: [{ t: 0, trimEnd: 0 }, { t: 0.6, trimEnd: 100, ease: "ease-out" }] }] },
          keyframes: { opacity: fadeOut.map((k) => ({ ...k, t: Math.max(0, r(k.t - 0.25)) })) } });
        if (logo) out.push(image("c_brand_intro_logo", logo, s0, d, short * 0.3, short * 0.1, 0, Math.round(short * 0.24), { opacity: fadeOut }));
      } else {
        if (logo) out.push(image("c_brand_intro_logo", logo, s0, d, short * 0.46, short * 0.24, 0, -Math.round(short * 0.05), follow({
          scale: [{ t: 0, v: 0.7 }, { t: 0.55, v: 1, ease: "ease-out" }].map((k) => ({ ...k, v: k.v })),
          opacity: fadeOut,
        }, -Math.round(short * 0.05))));
        if (name) out.push(text("c_brand_intro_name", "V8", s0 + 0.3, d - 0.3, {
          text: caps(name), font: look.headingFont, bold: true, fontSize: Math.round(short * (logo ? 0.045 : 0.08)), letterSpacing: look.letterSpacing,
          y: logo ? Math.round(short * 0.14) : 0, textAnim: "rise-mask",
        }, style === "logo-reveal" ? { y: leave.y!.map((k) => ({ ...k, t: Math.max(0, r(k.t - 0.3)), v: k.v + (logo ? Math.round(short * 0.14) : 0) })) } : undefined));
      }
      // the logo's own scale keyframes must multiply its fitted scale
      const lc = out.find((c) => c.id === "c_brand_intro_logo") as { props: { scale: number }; keyframes?: Record<string, Key[]> } | undefined;
      if (lc?.keyframes?.scale) lc.keyframes.scale = lc.keyframes.scale.map((k) => ({ ...k, v: r(k.v * lc.props.scale) }));
    } else if (style === "bar-wipe") {
      const barH = Math.round(short * 0.2);
      out.push({ id: "c_brand_intro_bar", mediaId: null, kind: "shape", track: "V6", start: r(s0), in: 0, duration: r(d), name: "Bar",
        props: { shapes: [{ type: "rect", w: W, h: barH, fill: look.accent, keys: [{ t: 0, w: 0 }, { t: 0.5, w: W, ease: "ease-out" }, { t: r(exit), w: W }, { t: r(d), w: 0, ease: "ease-in" }] }] } });
      const label = caps(b.intro.title || name);
      if (label) out.push(text("c_brand_intro_title", "V8", s0 + 0.35, Math.max(0.4, exit - 0.35), {
        text: label, font: look.headingFont, bold: true, fontSize: Math.round(short * 0.07), letterSpacing: look.letterSpacing, textAnim: "rise-mask", boxH: barH,
      }));
      if (logo) out.push(image("c_brand_intro_logo", logo, s0 + 0.35, Math.max(0.4, exit - 0.35), short * 0.22, short * 0.08, 0, -Math.round(barH * 0.5 + short * 0.08)));
    }
  }

  /* ── Outro ── */
  if (win.outro) {
    const [s0, s1] = win.outro;
    const d = s1 - s0;
    const style = b.outro.style;
    const agent = b.agent;
    const contact = agent ? [agent.phone, agent.email].filter(Boolean).join("\n") : "";
    if (style === "contact-bar") {
      const barH = Math.round(short * 0.2), y = Math.round(H / 2 - barH / 2 - short * 0.06);
      out.push(panel("c_brand_outro_bar", s0, d, look.panel, 0.92, { x: [{ t: 0, v: -W }, { t: 0.5, v: 0, ease: "ease-out" }] }, W, barH, y));
      const who = agent ? [agent.name, agent.brokerage ?? b.companyName].filter(Boolean).join(" · ") : b.companyName ?? "";
      if (who) out.push(text("c_brand_outro_name", "V8", s0 + 0.35, d - 0.35, { text: caps(who), font: look.headingFont, bold: true, fontSize: Math.round(short * 0.045), y: y - Math.round(barH * 0.18), textAnim: "rise-mask", boxH: Math.round(barH * 0.45) }));
      if (agent?.phone) out.push(text("c_brand_outro_contact", "V8", s0 + 0.55, d - 0.55, { text: agent.phone, fontSize: Math.round(short * 0.036), y: y + Math.round(barH * 0.22), textAnim: "word-slide", boxH: Math.round(barH * 0.4) }));
    } else {
      out.push(panel("c_brand_outro_panel", s0, d, look.panel, 1, { y: [{ t: 0, v: H }, { t: 0.5, v: 0, ease: "ease-out" }] }));
      if (style === "agent-card" && agent) {
        const layout = agent.layout === "photo-left" && !wide ? "centered" : agent.layout;
        const pic = layout !== "minimal" && headshot ? headshot : null;
        const size = Math.round(short * (wide ? 0.4 : 0.34));
        const leftX = layout === "photo-left" ? -Math.round(W * 0.24) : 0;
        const textX = layout === "photo-left" ? Math.round(W * 0.12) : 0;
        const align = layout === "photo-left" ? "left" : "center";
        const boxW = layout === "photo-left" ? Math.round(W * 0.5) : Math.round(W * 0.84);
        let y = layout === "photo-left" || !pic ? -Math.round(short * 0.16) : Math.round(short * 0.06);
        if (pic) out.push(...portrait(pic, s0 + 0.35, d - 0.35, size, leftX, layout === "photo-left" ? 0 : -Math.round(short * 0.24)));
        const lines: { id: string; text: string; size: number; heading?: boolean; anim: string }[] = [
          { id: "name", text: caps(agent.name), size: 0.07, heading: true, anim: "rise-mask" },
          ...(agent.title ? [{ id: "title", text: agent.title, size: 0.036, anim: "word-slide" }] : []),
          ...(agent.brokerage ? [{ id: "brokerage", text: agent.brokerage, size: 0.036, anim: "word-slide" }] : []),
          ...(contact ? [{ id: "contact", text: contact, size: 0.04, anim: "word-slide" }] : []),
          ...(agent.license ? [{ id: "license", text: agent.license, size: 0.026, anim: "none" }] : []),
        ];
        lines.forEach((l, i) => {
          const h = Math.round(short * l.size * (l.text.split("\n").length) * 1.35);
          out.push(text(`c_brand_agent_${l.id}`, "V8", s0 + 0.45 + i * 0.12, d - 0.45 - i * 0.12, {
            text: l.text, font: l.heading ? look.headingFont : look.bodyFont, bold: !!l.heading, fontSize: Math.round(short * l.size),
            letterSpacing: l.heading ? look.letterSpacing : 0, x: textX, y: y + Math.round(h / 2), align, boxW, boxH: h, textAnim: l.anim,
          }));
          y += h + Math.round(short * 0.012);
        });
        if (brokerageLogo) out.push(image("c_brand_brokerage_logo", brokerageLogo, s0 + 0.6, d - 0.6, short * 0.3, short * 0.09, layout === "photo-left" ? textX - Math.round(boxW / 2) + Math.round(short * 0.15) : 0, Math.min(Math.round(H / 2 - short * 0.16), y + Math.round(short * 0.08)), { opacity: [{ t: 0, v: 0 }, { t: 0.4, v: 1 }] }));
      } else {
        // logo end card (also used when there's no agent)
        if (logo) out.push(image("c_brand_outro_logo", logo, s0 + 0.3, d - 0.3, short * 0.44, short * 0.22, 0, -Math.round(short * 0.1), { opacity: [{ t: 0, v: 0 }, { t: 0.4, v: 1 }] }));
        const lines = [b.companyName, agent?.name, agent?.phone].filter(Boolean).join("\n");
        if (lines) out.push(text("c_brand_outro_text", "V8", s0 + 0.5, d - 0.5, {
          text: lines, font: look.headingFont, bold: true, fontSize: Math.round(short * 0.045), y: Math.round(short * (logo ? 0.12 : 0)), textAnim: "rise-mask", boxH: Math.round(short * 0.24),
        }));
        if (brokerageLogo) out.push(image("c_brand_brokerage_logo", brokerageLogo, s0 + 0.6, d - 0.6, short * 0.26, short * 0.08, 0, Math.round(short * 0.3)));
      }
    }
  }

  /* ── Disclosure (whole last scene) ── */
  if (b.disclosure) {
    const size = Math.max(16, Math.round(short * 0.022));
    const h = Math.round(size * 2.8);
    out.push(text("c_brand_disclosure", "V9", win.lastStart, win.total - win.lastStart, {
      text: b.disclosure, fontSize: size, color: "#FFFFFF", bgColor: "#000000", bgOpacity: 0.55, lineHeight: 1.25,
      y: Math.round(H / 2 - h / 2 - short * 0.02), boxW: Math.round(W * 0.92), boxH: h, textAnim: "none",
    }));
  }
  return out;
}
