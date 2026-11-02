"use client";
import { useMemo, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { APERTURE_EFFECT, CAMERA_MOVES, FOCAL_PERSPECTIVE, LENS_MAP, buildMotionPrompt } from "@lvs/camera-presets";
import { NativeSelect } from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Live preview of each camera move (Ken Burns version) with plain-language copy. */
export function MovePicker({ advanced }: { advanced: boolean }) {
  const [moveId, setMoveId] = useState(CAMERA_MOVES[0]!.id);
  const [lens, setLens] = useState("");
  const [focal, setFocal] = useState("");
  const [aperture, setAperture] = useState("");
  const move = CAMERA_MOVES.find((m) => m.id === moveId)!;
  const prompt = useMemo(
    () => buildMotionPrompt(moveId, { lens: lens || undefined, focalLength: focal ? Number(focal) : undefined, aperture: aperture || undefined }),
    [moveId, lens, focal, aperture],
  );
  const kb = move.kenBurns;
  const previewStyle = {
    "--kb-from": kb.scaleFrom, "--kb-to": kb.scaleTo, "--kb-x": `${kb.panX}%`, "--kb-y": `${kb.panY}%`,
  } as React.CSSProperties;

  return (
    <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
      <div className="flex flex-col gap-4">
        <div className="relative aspect-video overflow-hidden rounded-xl bg-sidebar" aria-hidden="true">
          <div key={moveId} className="absolute inset-0 animate-kb-move" style={previewStyle}>
            <div className="grid h-full grid-cols-3 grid-rows-2 gap-2 p-6 opacity-90">
              <div className="col-span-2 rounded-lg bg-amber-200/80" />
              <div className="rounded-lg bg-sky-200/80" />
              <div className="rounded-lg bg-emerald-200/80" />
              <div className="col-span-2 rounded-lg bg-rose-200/80" />
            </div>
          </div>
          <span className="absolute bottom-3 left-3 rounded-md bg-black/70 px-3 py-1 text-sm font-semibold text-white">{move.name}</span>
        </div>
        <p className="text-lg">{move.description}</p>
        {move.aiOnly ? (
          <p className="flex items-center gap-2 text-base text-muted-foreground"><Sparkles className="size-5 text-primary" aria-hidden="true" />Uses AI for real 3D motion. The preview shows the simple version.</p>
        ) : (
          <p className="text-base text-muted-foreground">Free — works on any photo, no AI needed.</p>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <div role="radiogroup" aria-label="Camera move" className="grid grid-cols-2 gap-3">
          {CAMERA_MOVES.map((m) => {
            const selected = m.id === moveId;
            return (
              <button
                key={m.id} type="button" role="radio" aria-checked={selected} onClick={() => setMoveId(m.id)}
                className={cn("flex min-h-16 flex-col items-start justify-center gap-1 rounded-xl border-2 px-4 py-3 text-left", selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/40")}
              >
                <span className="flex w-full items-center justify-between font-semibold">{m.name}{selected ? <Check className="size-5 text-primary" aria-hidden="true" /> : null}</span>
                {m.aiOnly ? <Badge variant="default">AI</Badge> : <Badge variant="success">Free</Badge>}
              </button>
            );
          })}
        </div>

        {advanced ? (
          <div className="flex flex-col gap-4 rounded-xl border p-4">
            <p className="font-semibold">Lens look (for AI moves)</p>
            <div className="flex flex-col gap-2">
              <Label htmlFor="lens">Lens</Label>
              <NativeSelect id="lens" value={lens} onChange={(e) => setLens(e.target.value)}>
                <option value="">Automatic</option>
                {Object.keys(LENS_MAP).map((k) => <option key={k} value={k}>{k}</option>)}
              </NativeSelect>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="focal">Focal length</Label>
                <NativeSelect id="focal" value={focal} onChange={(e) => setFocal(e.target.value)}>
                  <option value="">Automatic</option>
                  {Object.keys(FOCAL_PERSPECTIVE).map((k) => <option key={k} value={k}>{k} mm</option>)}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="aperture">Aperture</Label>
                <NativeSelect id="aperture" value={aperture} onChange={(e) => setAperture(e.target.value)}>
                  <option value="">Automatic</option>
                  {Object.keys(APERTURE_EFFECT).map((k) => <option key={k} value={k}>{k}</option>)}
                </NativeSelect>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold">Instructions sent to the AI</p>
              <p className="rounded-lg bg-muted p-3 font-mono text-sm leading-relaxed">{prompt}</p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
