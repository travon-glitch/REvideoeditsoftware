/*
 * Generative image-to-video through MuAPI — the provider Open Generative AI's
 * studios use. Request flow adapted from Open-Generative-AI src/lib/muapi.js
 * (Anil-matcha/Open-Generative-AI, MIT): upload the photo, submit to the
 * model's endpoint, poll /predictions/{id}/result, download the video.
 *
 * Configure on the worker only (never in the browser):
 *   MUAPI_API_KEY=…            required to enable this provider
 *   MUAPI_I2V_MODEL=…          optional, default kling-v2.1-standard-i2v
 *   MUAPI_BASE_URL=…           optional, default https://api.muapi.ai
 */
import type { GenerativeProvider, GenerativeRequest, GenerativeResult } from "./types.ts";

type Fetch = typeof fetch;

export interface MuapiOptions { apiKey: string; model?: string; baseUrl?: string; fetch?: Fetch; pollMs?: number; maxPolls?: number }

export class MuapiProvider implements GenerativeProvider {
  readonly id = "muapi";
  readonly label = "MuAPI image-to-video";
  readonly model: string;
  private readonly key: string;
  private readonly base: string;
  private readonly f: Fetch;
  private readonly pollMs: number;
  private readonly maxPolls: number;

  constructor(o: MuapiOptions) {
    this.key = o.apiKey;
    this.model = o.model ?? "kling-v2.1-standard-i2v";
    this.base = (o.baseUrl ?? "https://api.muapi.ai").replace(/\/$/, "");
    this.f = o.fetch ?? fetch;
    this.pollMs = o.pollMs ?? 4000;
    this.maxPolls = o.maxPolls ?? 450;
  }

  private async json(res: Response, what: string): Promise<Record<string, unknown>> {
    if (!res.ok) throw new Error(`${what} failed (${res.status}): ${(await res.text()).slice(0, 160)}`);
    return (await res.json()) as Record<string, unknown>;
  }

  async imageToVideo(req: GenerativeRequest): Promise<GenerativeResult> {
    // 1. upload the photo
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(req.photo)], { type: req.mimeType }), req.fileName);
    const up = await this.json(await this.f(`${this.base}/api/v1/upload_file`, { method: "POST", headers: { "x-api-key": this.key }, body: form }), "Photo upload");
    const imageUrl = (up.url ?? up.file_url ?? (up.data as { url?: string } | undefined)?.url) as string | undefined;
    if (!imageUrl) throw new Error("The AI provider didn't return an image link");

    // 2. submit
    const submit = await this.json(await this.f(`${this.base}/api/v1/${encodeURIComponent(this.model)}`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-api-key": this.key },
      body: JSON.stringify({ prompt: req.prompt, image_url: imageUrl, aspect_ratio: req.aspect, duration: req.durationSeconds }),
    }), "AI request");
    const requestId = (submit.request_id ?? submit.id) as string | undefined;
    if (!requestId) throw new Error("The AI provider didn't return a job id");
    await req.onProviderJob?.(requestId);

    // 3. poll
    for (let i = 0; i < this.maxPolls; i++) {
      await new Promise((r) => setTimeout(r, this.pollMs));
      const res = await this.f(`${this.base}/api/v1/predictions/${encodeURIComponent(requestId)}/result`, { headers: { "x-api-key": this.key } });
      if (res.status >= 500) continue;
      const data = await this.json(res, "AI status check");
      const status = String(data.status ?? "").toLowerCase();
      if (status === "failed" || status === "error") throw new Error(`The AI provider couldn't make the video: ${String(data.error ?? "unknown error").slice(0, 160)}`);
      if (status === "completed" || status === "succeeded" || status === "success") {
        const url = ((data.outputs as string[] | undefined)?.[0] ?? data.url ?? (data.output as { url?: string } | undefined)?.url) as string | undefined;
        if (!url) throw new Error("The AI provider finished without a video");
        // 4. download
        const vid = await this.f(url);
        if (!vid.ok) throw new Error(`Downloading the AI video failed (${vid.status})`);
        return { video: new Uint8Array(await vid.arrayBuffer()), providerJobId: requestId, model: this.model };
      }
    }
    throw new Error("The AI provider took too long");
  }
}
