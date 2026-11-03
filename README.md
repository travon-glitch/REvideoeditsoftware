# Video Studio — private AI real-estate video generator

Company-owned, internal-only application for turning listing photos into marketing videos.
No public registration, no subscriptions, no billing, no public project access.

| Path | What |
|---|---|
| `apps/web` | Next.js 15 + TypeScript + Tailwind + shadcn/ui app (Supabase Auth, Postgres, Storage) |
| `packages/fablecut-core` | Vendored FableCut editor/render engine (MIT), unmodified, + a small Node wrapper |
| `packages/camera-presets` | Camera moves for listing photos; includes Open-Generative-AI's lens tables (MIT) verbatim |
| `supabase/` | Database migration (schema, Row-Level Security, storage, one-time setup), local config |
| `docs/` | Architecture, setup guide, and one report per stage (`STAGE2.md` … `STAGE13.md`) |
| `reference/` | Upstream clones for auditing — git-ignored, never deployed |

## Quick start

See **[docs/SETUP.md](docs/SETUP.md)**. Short version:

```bash
npm install
```

```bash
cp apps/web/.env.example apps/web/.env.local
```

```bash
npm run bootstrap:token
```

```bash
npm run dev
```

Then open `http://localhost:3000/setup` once to create the Super Admin.

## Checks

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run build
```

Licensing: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [docs/LICENSES.md](docs/LICENSES.md).
