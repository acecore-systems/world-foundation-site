# World Foundation Site

This repository is the web presentation layer for [`acecore-systems/world-foundation`](https://github.com/acecore-systems/world-foundation).

The source of truth remains the Markdown files in `world-foundation`. This repository only contains the Starlight configuration, sync script, and Cloudflare Pages build configuration used to publish those documents as a website.

## Local Development

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

The build script runs `scripts/sync-content.mjs` first. Generated pages are written to `src/content/docs/` and should not be edited by hand.

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
