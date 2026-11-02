# Vendored upstream: FableCut

| | |
|---|---|
| Repository | https://github.com/ronak-create/FableCut |
| Commit | `579b08ec1a789baec5cbf06d7430373460508d09` (2026-10-30) |
| Version | 1.18.0 |
| License | MIT — © 2026 ronak-create (see `LICENSE`) |
| Vendored on | 2026-11-02 |

## What was copied

Every git-tracked file at that commit **except** `docs/` (the project website), `media/`, `exports/` and `.github/`.
Files are unchanged byte-for-byte under `upstream/`. Bundled fonts in `upstream/library/fonts/` are SIL OFL 1.1
(see `upstream/library/fonts/LICENSES.md`); full OFL texts must be added to `THIRD_PARTY_NOTICES.md` before the editor ships.

## How the platform uses it

| Stage | Use |
|---|---|
| 2 (now) | `index.js` exposes Node-safe document modules (`edit-ops`, `project-ops`, `motion`, `templates`, `delivery`, `sequences`). Nothing is served to browsers. |
| 3 | Editor UI served from an isolated origin, talking to the tenant-scoped Editor Gateway (not upstream `server.js`). |
| 4 | Headless-Chromium render workers run the upstream Fast export. |

## Never deployed

`server.js`, `mcp-server.js`, `cli.js` — single-user and unauthenticated by design (see `docs/OPEN_SOURCE_AUDIT.md` F1–F10).

## Patch queue (applied in Stage 3, kept as files in `patches/`)

| Patch | Purpose | Status |
|---|---|---|
| P01 api-base | Configurable API base URL + bearer token from `postMessage` | planned |
| P02 remove-path-arg | Remove `/api/frame?path=` bypass (arbitrary file read) | planned |
| P03 no-cdn | Self-host transformers.js / MediaPipe / fonts with SRI | planned |
| P04 project-identity | Explicit `projectId` on every call | planned |
| P05 feature-flags | Hide features the gateway does not support yet | planned |
| P06 svg-policy | No raw SVG uploads | planned |
| P07 postmessage-bridge | Save/dirty events to the platform shell | planned |

## Updating

1. Clone the new upstream commit into `reference/FableCut`.
2. Re-copy with the same exclusions, update this table, re-run `npm test -w @lvs/fablecut-core`.
3. Re-apply `patches/` in order; resolve conflicts in the patch files, never in `upstream/` directly.
