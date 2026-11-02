import { Clapperboard } from "lucide-react";

export function BrandMark({ companyName, logoUrl }: { companyName: string; logoUrl?: string | null }) {
  return (
    <div className="flex items-center gap-3">
      {logoUrl ? (
        // Signed URL from private storage; plain <img> avoids next/image remote config.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="size-10 rounded-lg bg-white object-contain p-1" />
      ) : (
        <div className="flex size-10 items-center justify-center rounded-lg bg-brand text-white">
          <Clapperboard className="size-5" aria-hidden="true" />
        </div>
      )}
      <div className="min-w-0 leading-tight">
        <p className="truncate font-bold text-white">{companyName}</p>
        <p className="text-sm text-sidebar-muted">Video Studio</p>
      </div>
    </div>
  );
}
