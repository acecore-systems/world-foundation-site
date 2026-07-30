# World Foundation Site

This repository is the web presentation layer for [`acecore-systems/world-foundation`](https://github.com/acecore-systems/world-foundation).

The source of truth remains the Markdown files in `world-foundation`. The site currently runs on Astro 7 and Starlight 0.41. This repository only contains the Starlight configuration, sync script, and Cloudflare Pages build configuration used to publish those documents as a website.

## Local Development

Node.js 24.18.0 or later is required. The repository-pinned version is recorded in `.node-version`.

Clone both repositories as siblings:

```txt
repos/
  world-foundation/
  world-foundation-site/
```

Then run:

```sh
npm install
npm run dev
```

Set `WORLD_FOUNDATION_SOURCE` if the content repository is not in `../world-foundation`:

```sh
WORLD_FOUNDATION_SOURCE=/path/to/world-foundation npm run dev
```

## Build

```sh
npm run build
```

The build script runs `scripts/sync-content.mjs` first. Generated pages are written to `src/content/docs/` and should not be edited by hand. It also generates the deterministic Vectorize corpus and the public site/content build marker after Astro finishes.

## Search

Starlight's Pagefind search remains the primary, browser-local search. Cloudflare Vectorize adds a fail-soft “Related content” section using the multilingual `@cf/baai/bge-m3` embedding model.

- Pages Function: `/api/search`
- Preview and production use separate Vectorize indexes and D1 rate-limit databases.
- Index writes are only performed by the protected synchronization workflow.
- If Workers AI, Vectorize, or D1 is unavailable, Pagefind continues to work.
- Production semantic search is enabled. A protected `main` push synchronizes the exact public build automatically. Delivered Cloudflare Pages Production check events can synchronize content-only Deploy Hook builds sooner, while a separate 15-minute reconciliation workflow covers missed events; manual Production dispatch remains the force-repair path.

Starlight only mounts Pagefind and the related-content UI in a production build. Use a Pages preview or `wrangler pages dev` for rendered search QA; `astro dev` intentionally shows Starlight's development warning instead.

See [the Vectorize operations guide](docs/vectorize-search.md) for resource names, synchronization safeguards, privacy controls, and release checks.

## Deployment

Cloudflare Pages is connected to this repository through the Git integration. Cloudflare clones this repository on each push, fetches the source documents from `acecore-systems/world-foundation`, builds Starlight, and publishes the result.

Cloudflare Pages settings:

```txt
Project name: world-foundation-site
Production branch: main
Build command: npm run build:cloudflare
Build output directory: dist
Root directory: /
```

For a local manual build:

```sh
npm run build
```

## Repository Boundary

- Edit source documents in `acecore-systems/world-foundation`.
- Edit website rendering, synchronization, and deployment behavior here.
- Do not move the canonical docs into this repository.
