"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/session";
import { uiModeSchema } from "@/lib/validation";

/** Saves Easy / Advanced mode on the person's profile. */
export async function setUiMode(mode: string): Promise<void> {
  const parsed = uiModeSchema.safeParse(mode);
  const ctx = await getSessionContext();
  if (!parsed.success || !ctx) return;
  const supabase = await createClient();
  await supabase.from("profiles").update({ ui_mode: parsed.data }).eq("id", ctx.userId);
  revalidatePath("/", "layout");
}
