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

Cloudflare Vectorize is the primary search. When it returns valid local results, the search dialog shows those semantic results first. Starlight's browser-local Pagefind remains the fallback only when the Vectorize API is unavailable, rate-limited, unconfigured, malformed, or produces no valid result.

- Pages Function: `/api/search`
- Pages Preview has no Vectorize binding, so it automatically uses Pagefind as the local fallback.
- Production uses the single Vectorize candidate index and its D1 rate-limit database.
- Index writes are only performed by the protected Production synchronization workflow.
- A non-blocking lower “Acecore関連サイト” / “Related Acecore sites” section calls `https://acecore.net/api/network-search` with only `{ query, locale: 'ja' }`. The central service derives the caller from `Origin`; the client excludes its own source and strictly accepts only official HTTPS allowlisted results.
- If Workers AI, Vectorize, or D1 is unavailable, Pagefind continues to work.
- Production semantic search is enabled after the 1,536-dimension candidate index converged at 135 vectors and passed Japanese and English namespace canaries. Root and Pages Preview remain disabled. A protected `main` push synchronizes the exact public build automatically. Delivered Cloudflare Pages Production check events can synchronize content-only Deploy Hook builds sooner, while a separate 15-minute reconciliation workflow covers missed events; manual Production dispatch remains the force-repair path.

Starlight only mounts Pagefind and the related-content UI in a production build. Use a Pages preview or `wrangler pages dev` for rendered search QA; `astro dev` intentionally shows Starlight's development warning instead.

See [the Vectorize operations guide](docs/04_運用設計/01_Vectorize検索運用.md) for resource names, synchronization safeguards, privacy controls, and release checks.

See [the documentation index](docs/README.md) for this repository's requirements, architecture, and operations documents.

## Deployment

Cloudflare Pages is connected to this repository through the Git integration. Cloudflare clones this repository on each push, fetches the source documents from `acecore-systems/world-foundation`, builds Starlight, and publishes the result.

Feature branches receive Cloudflare Pages Preview deployments. Reviewed pull requests merge directly into `main`; a `main` push is the only Git-connected Production release path.

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
