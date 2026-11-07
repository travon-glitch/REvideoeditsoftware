"use client";
/* "Camera feel": how the move is operated — steady like a tripod, or carried like a gimbal. */
import { GIMBAL_LEVELS, type CameraSpec } from "@lvs/camera-presets";
import { cn } from "@/lib/utils";

export function GimbalPicker({ spec, setSpec, id = "gimbal" }: {
  spec: CameraSpec;
  setSpec: (fn: (s: CameraSpec) => CameraSpec, key?: string) => void;
  id?: string;
}) {
  const g = spec.gimbal ?? 0;
  // the closest level (specs can hold any value 0…1)
  const current = GIMBAL_LEVELS.reduce((a, b) => (Math.abs(b.value - g) < Math.abs(a.value - g) ? b : a));
  return (
    <div className="flex flex-col gap-2">
      <span id={`${id}-label`} className="text-sm font-semibold">Camera feel</span>
      <div role="radiogroup" aria-labelledby={`${id}-label`} className="grid grid-cols-4 gap-1.5">
        {GIMBAL_LEVELS.map((l) => (
          <button key={l.id} type="button" role="radio" aria-checked={current.id === l.id} title={l.hint}
            onClick={() => setSpec((s) => ({ ...s, gimbal: l.value }))}
            className={cn("min-h-10 rounded-lg border-2 px-1 text-xs font-semibold", current.id === l.id ? "border-primary bg-primary/5" : "border-border")}>
            {l.id === "off" ? "Steady" : l.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {g > 0
          ? "Gimbal feel: eases in and settles, floats slightly, banks into turns, with film motion blur — like a camera operator, not a computer slide."
          : "Steady: perfectly smooth, like a tripod or a camera slider."}
      </p>
    </div>
  );
}
