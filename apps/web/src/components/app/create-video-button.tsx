import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The most visible action in the app. */
export function CreateVideoButton({ className, size = "lg" }: { className?: string; size?: "lg" | "xl" }) {
  return (
    <Button asChild size={size} className={cn("bg-brand text-white shadow-md hover:bg-brand/90", className)}>
      <Link href="/create">
        <Plus aria-hidden="true" />
        Create New Video
      </Link>
    </Button>
  );
}
