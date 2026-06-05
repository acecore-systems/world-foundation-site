# World Foundation Site

This repository is the web presentation layer for [`acecore-systems/world-foundation`](https://github.com/acecore-systems/world-foundation).

The source of truth remains the Markdown files in `world-foundation`. This repository only contains the Starlight configuration, sync script, and deployment workflow used to publish those documents as a website.

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

GitHub Actions checks out both repositories, syncs content from `acecore-systems/world-foundation`, builds Starlight, and publishes the result to GitHub Pages.

## Repository Boundary

- Edit source documents in `acecore-systems/world-foundation`.
- Edit website rendering, synchronization, and deployment behavior here.
- Do not move the canonical docs into this repository.
