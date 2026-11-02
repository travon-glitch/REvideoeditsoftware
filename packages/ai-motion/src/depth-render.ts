/*
 * AI DEPTH camera method: turns one photo + its estimated depth map into a
 * short clip where a virtual camera really moves through the scene (near
 * things shift more than far things — true parallax).
 *
 * How: the photo becomes a 3D mesh (a vertex every 4 px, pushed back by its
 * depth); each frame the mesh is projected through a pinhole camera at the
 * pose from @lvs/camera-presets depthPose() and rasterised with a z-buffer.
 *
 * Limits (stated in the UI): a single photo has no information about hidden
 * surfaces. Where the depth jumps (a railing in front of a wall), the mesh
 * stretches. Those pixels are counted and reported as "stretched areas", so
 * the clip can be flagged for review.
 */
import { EASE_FN, LENS_FEEL, depthPose, normalizeSpec, poseTurnsAroundPivot, type CameraSpec } from "@lvs/camera-presets";
import type { DepthMap } from "./depth.ts";
import type { Rgb } from "./media.ts";

/** How much bigger than the output the source is prepared (room to move). */
export const OVERSCAN = 1.18;
const GRID = 4;
/** A triangle whose corners' depths differ by more than this ratio bridges a depth edge (it will stretch). */
const EDGE_RATIO = 1.12;

type V3 = [number, number, number];
type M3 = [number, number, number, number, number, number, number, number, number];

function rotY(a: number): M3 { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
function rotX(a: number): M3 { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; }
function rotZ(a: number): M3 { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; }
function mul(a: M3, b: M3): M3 {
  const o = new Array(9).fill(0) as M3;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!;
  return o;
}
function apply(m: M3, v: V3): V3 {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}
const deg = (d: number) => (d * Math.PI) / 180;

export interface DepthClipOptions {
  spec: CameraSpec;
  duration: number;
  width: number;
  height: number;
  fps?: number;
}

export interface FrameStats { stretched: number; uncovered: number }

/**
 * A prepared scene: mesh vertices in 3D. `source` and `depth` must be the photo
 * cover-fitted to (width·OVERSCAN)×(height·OVERSCAN).
 */
export class DepthScene {
  readonly sw: number; readonly sh: number;
  readonly gw: number; readonly gh: number;
  private P: Float32Array;   // world xyz per vertex
  private Z: Float32Array;   // depth per vertex
  private U: Float32Array; private Vv: Float32Array; // texture coords (source px)
  readonly f0: number;
  /** Extra zoom chosen by fitGuard() so the camera never sees past the photo's edge. */
  guard = 1;

  readonly source: Rgb;
  readonly out: { width: number; height: number };
  readonly spec: CameraSpec;

  constructor(source: Rgb, depth: DepthMap, out: { width: number; height: number }, spec: CameraSpec) {
    this.source = source; this.out = out; this.spec = spec;
    if (depth.width !== source.width || depth.height !== source.height) throw new Error("Depth and photo sizes differ");
    const s = normalizeSpec(spec);
    this.sw = source.width; this.sh = source.height;
    const fov0 = depthPose(s, 0).fovDeg;
    this.f0 = out.width / 2 / Math.tan(deg(fov0) / 2);
    this.gw = Math.floor((this.sw - 1) / GRID) + 1;
    this.gh = Math.floor((this.sh - 1) / GRID) + 1;
    const n = this.gw * this.gh;
    this.P = new Float32Array(n * 3); this.Z = new Float32Array(n); this.U = new Float32Array(n); this.Vv = new Float32Array(n);
    // nearness 0…1 → inverse depth 1 … 1+4·intensity; scaled so the median depth is 1
    const k = 3 * Math.max(0.05, s.depth);
    const inv: number[] = [];
    for (let j = 0; j < this.gh; j++) for (let i = 0; i < this.gw; i++) {
      const x = Math.min(this.sw - 1, i * GRID), y = Math.min(this.sh - 1, j * GRID);
      inv.push(1 + k * depth.data[y * this.sw + x]!);
    }
    const sorted = [...inv].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const cx = this.sw / 2, cy = this.sh / 2;
    for (let j = 0, v = 0; j < this.gh; j++) for (let i = 0; i < this.gw; i++, v++) {
      const x = Math.min(this.sw - 1, i * GRID), y = Math.min(this.sh - 1, j * GRID);
      const z = median / inv[v]!;
      this.Z[v] = z; this.U[v] = x; this.Vv[v] = y;
      this.P[v * 3] = ((x + 0.5 - cx) * z) / this.f0;
      this.P[v * 3 + 1] = ((y + 0.5 - cy) * z) / this.f0;
      this.P[v * 3 + 2] = z;
    }
  }

  /** Renders the frame at eased progress u into `rgb` (width·height·3). */
  renderFrame(u: number, rgb: Uint8Array, zbuf: Float32Array, flag: Uint8Array): FrameStats {
    const { width: W, height: H } = this.out;
    const pose = depthPose(this.spec, u);
    const f = (W / 2 / Math.tan(deg(pose.fovDeg) / 2)) * this.guard;
    // camera orientation and position
    let R: M3;
    let C: V3;
    if (poseTurnsAroundPivot(this.spec.move)) {
      const pv: V3 = [pose.pivot.x * W / this.f0, pose.pivot.y * H / this.f0, 1];
      const th = -deg(pose.yaw);
      const Ry = rotY(th);
      const rel = apply(Ry, [-pv[0], -pv[1], -pv[2]]);
      C = [pv[0] + rel[0] + pose.tx, pv[1] + rel[1] + pose.ty, pv[2] + rel[2] + pose.tz];
      R = mul(mul(Ry, rotX(deg(pose.pitch))), rotZ(deg(pose.roll)));
    } else {
      C = [pose.tx, pose.ty, pose.tz];
      R = mul(mul(rotY(deg(pose.yaw)), rotX(deg(pose.pitch))), rotZ(deg(pose.roll)));
    }
    // world → camera = Rᵀ (P − C)
    const r = R;
    const n = this.gw * this.gh;
    const sx = new Float32Array(n), sy = new Float32Array(n), sz = new Float32Array(n);
    for (let v = 0; v < n; v++) {
      const px = this.P[v * 3]! - C[0], py = this.P[v * 3 + 1]! - C[1], pz = this.P[v * 3 + 2]! - C[2];
      const cxv = r[0] * px + r[3] * py + r[6] * pz;
      const cyv = r[1] * px + r[4] * py + r[7] * pz;
      const czv = r[2] * px + r[5] * py + r[8] * pz;
      sz[v] = czv;
      sx[v] = czv > 0.02 ? (f * cxv) / czv + W / 2 : NaN;
      sy[v] = czv > 0.02 ? (f * cyv) / czv + H / 2 : NaN;
    }
    zbuf.fill(Infinity);
    flag.fill(0);
    const src = this.source.data, SW = this.sw, SH = this.sh;
    const tri = (a: number, b: number, c: number) => {
      const ax = sx[a]!, ay = sy[a]!, bx = sx[b]!, by = sy[b]!, cx = sx[c]!, cy = sy[c]!;
      if (Number.isNaN(ax) || Number.isNaN(bx) || Number.isNaN(cx)) return;
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(area) < 1e-6) return;
      const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxX = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
      const minY = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxY = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
      if (minX > maxX || minY > maxY) return;
      const za = this.Z[a]!, zb = this.Z[b]!, zc = this.Z[c]!;
      const stretched = Math.max(za, zb, zc) / Math.min(za, zb, zc) > EDGE_RATIO ? 1 : 0;
      const ua = this.U[a]!, ub = this.U[b]!, uc = this.U[c]!, va = this.Vv[a]!, vb = this.Vv[b]!, vc = this.Vv[c]!;
      const da = sz[a]!, db = sz[b]!, dc = sz[c]!;
      const inv = 1 / area;
      for (let y = minY; y <= maxY; y++) {
        const py = y + 0.5;
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5;
          const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) * inv;
          const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) * inv;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
          const z = w0 * da + w1 * db + w2 * dc;
          const idx = y * W + x;
          if (z >= zbuf[idx]!) continue;
          zbuf[idx] = z;
          flag[idx] = 1 + stretched;
          // bilinear sample of the photo
          const su = Math.min(SW - 1.001, Math.max(0, w0 * ua + w1 * ub + w2 * uc));
          const sv = Math.min(SH - 1.001, Math.max(0, w0 * va + w1 * vb + w2 * vc));
          const x0 = su | 0, y0 = sv | 0, fx = su - x0, fy = sv - y0;
          const i00 = (y0 * SW + x0) * 3, i10 = i00 + 3, i01 = i00 + SW * 3, i11 = i01 + 3;
          const o = idx * 3;
          for (let ch = 0; ch < 3; ch++) {
            const top = src[i00 + ch]! * (1 - fx) + src[i10 + ch]! * fx;
            const bot = src[i01 + ch]! * (1 - fx) + src[i11 + ch]! * fx;
            rgb[o + ch] = top * (1 - fy) + bot * fy;
          }
        }
      }
    };
    for (let j = 0; j < this.gh - 1; j++) {
      for (let i = 0; i < this.gw - 1; i++) {
        const a = j * this.gw + i, b = a + 1, c = a + this.gw, d = c + 1;
        tri(a, b, d); tri(a, d, c);
      }
    }
    // fill any uncovered pixels from the nearest covered pixel on the row (and count them)
    let uncovered = 0, stretched = 0;
    for (let y = 0; y < H; y++) {
      let last = -1;
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        if (flag[idx] === 0) { uncovered++; if (last >= 0) rgb.copyWithin(idx * 3, last * 3, last * 3 + 3); }
        else { last = idx; if (flag[idx] === 2) stretched++; }
      }
      // leading gap: copy from the first covered pixel
      const first = (() => { for (let x = 0; x < W; x++) if (flag[y * W + x] !== 0) return y * W + x; return -1; })();
      if (first > y * W) for (let x = y * W; x < first; x++) rgb.copyWithin(x * 3, first * 3, first * 3 + 3);
    }
    return { stretched: stretched / (W * H), uncovered: uncovered / (W * H) };
  }
}

/**
 * Zooms in just enough (up to 40%) that sampled frames don't run past the photo.
 * Returns the guard used.
 */
export function fitGuard(scene: DepthScene, spec: CameraSpec, speed = 1): number {
  const { width, height } = scene.out;
  const rgb = new Uint8Array(width * height * 3), z = new Float32Array(width * height), flag = new Uint8Array(width * height);
  const ease = EASE_FN[normalizeSpec(spec).easing];
  const us = [0, 0.25, 0.5, 0.75, 1].map((x) => ease(Math.min(1, x * Math.max(1, speed))));
  for (let g = 1; g <= 1.4; g *= 1.04) {
    scene.guard = g;
    if (us.every((u) => scene.renderFrame(u, rgb, z, flag).uncovered < 0.0005)) return g;
  }
  scene.guard = 1.4;
  return 1.4;
}

export interface DepthClipStats { frames: number; maxStretched: number; meanStretched: number; maxUncovered: number }

/** Renders every frame and hands it to `sink` (e.g. an Mp4Writer). */
export async function renderDepthClip(
  scene: DepthScene, opts: DepthClipOptions, sink: (frame: Uint8Array, index: number) => Promise<void>,
  onProgress?: (p: number) => void,
): Promise<DepthClipStats> {
  const fps = opts.fps ?? 30;
  const n = Math.max(2, Math.round(opts.duration * fps));
  const ease = EASE_FN[normalizeSpec(opts.spec).easing];
  const speed = Math.max(1, normalizeSpec(opts.spec).speed);
  const rgb = new Uint8Array(opts.width * opts.height * 3);
  const z = new Float32Array(opts.width * opts.height);
  const flag = new Uint8Array(opts.width * opts.height);
  let maxS = 0, sumS = 0, maxU = 0;
  for (let i = 0; i < n; i++) {
    const u = ease(Math.min(1, (i / (n - 1)) * speed));
    const st = scene.renderFrame(u, rgb, z, flag);
    maxS = Math.max(maxS, st.stretched); sumS += st.stretched; maxU = Math.max(maxU, st.uncovered);
    await sink(rgb, i);
    if (onProgress && i % 10 === 0) onProgress(i / n);
  }
  return { frames: n, maxStretched: maxS, meanStretched: sumS / n, maxUncovered: maxU };
}

/** Field of view of the simulated lens (for documentation / UI). */
export function simulatedFov(spec: CameraSpec): number {
  return spec.lens ? LENS_FEEL[spec.lens].fovDeg : LENS_FEEL[35].fovDeg;
}
