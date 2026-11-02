import "server-only";
import core from "@lvs/fablecut-core";

/** Validates (and normalizes in place) a FableCut project document with FableCut's own checker. */
export function validateFableCutDocument(doc: Record<string, unknown>): { ok: true } | { ok: false; error: string } {
  const checkProject = core.ProjectOps.checkProject;
  if (typeof checkProject !== "function") return { ok: false, error: "FableCut project validator is unavailable" };
  try {
    checkProject(doc);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
