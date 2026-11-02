/** Minimal typings for the vendored FableCut engine. Upstream modules are untyped JS. */
export interface UpstreamInfo {
  repository: string;
  commit: string;
  version: string;
  license: string;
}
export type ExposedModule = "editOps" | "projectOps" | "motion" | "templates" | "delivery" | "sequences";

export const UPSTREAM: UpstreamInfo;
export const UPSTREAM_DIR: string;
export const MODULES: Record<ExposedModule, string>;
export const EDITOR_STATIC_FILES: string[];
export function load(name: ExposedModule): Record<string, unknown>;

export const EditOps: Record<string, unknown>;
export const ProjectOps: {
  checkProject?: (doc: unknown) => void;
  compactView?: (doc: unknown) => string;
  [key: string]: unknown;
};
export const Motion: Record<string, unknown>;
export const Templates: Record<string, unknown>;
export const Delivery: Record<string, unknown>;
export const Sequences: Record<string, unknown>;
