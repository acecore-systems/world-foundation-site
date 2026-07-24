# Design QA: World Foundation LP option 2

## Visual target and capture method

- Accepted concept: `C:\Users\gnish\.codex\generated_images\019f93a2-e933-7443-93b6-9d02039547ad\call_nv3fCrxDA8jN2wL5sbu7b1qk.png`
- Concept native size: `864 × 1821`
- Browser method: Codex in-app browser against the static production build at `http://127.0.0.1:4399/`
- Screenshot method: in-app browser viewport screenshots with `tab.screenshot({ fullPage: false })`
- Full-page fallback: the in-app browser full-page capture tiled the page incorrectly, so the page was checked with top, middle, and bottom viewport captures plus DOM section measurements.
- Latest implementation screenshot: `C:\Users\gnish\.codex\visualizations\2026\07\24\019f93a2-e933-7443-93b6-9d02039547ad\qa-world-foundation-lp\implementation-desktop-864x1100.png`
- Combined comparison: `C:\Users\gnish\.codex\visualizations\2026\07\24\019f93a2-e933-7443-93b6-9d02039547ad\qa-world-foundation-lp\comparison-option-2-vs-implementation.png`
- `view_image` inspection completed for the accepted concept, latest implementation screenshot, and combined comparison image.

## Native-size comparison

The accepted concept was checked at its native `864px` width. The browser viewport was `864 × 1100`; its captured content area was `849 × 1081` after the browser scrollbar.

1. Header: concept and implementation both use a dark single-row header, left brand, centered navigation, and right language control. The implementation uses the existing favicon-derived mark instead of the concept's provisional W mark.
2. Hero: the H1 wording and two-line desktop composition match. The implementation uses the project's Japanese system-font stack, with a slightly tighter display size to keep the line breaks stable.
3. Hero actions: both primary and secondary CTAs retain the same order, visual weight, rectangular radius, and lime/cyan treatment.
4. Connection image: the section boundary matches the concept at `y = 492`, and the image ends at `y = 882` in both. The production WebP preserves the lime, cyan, blue, purple, central glow, and layered terrain concept.
5. Principles: the three numbered columns, accent progression, vertical dividers, and directional arrows match the target hierarchy.
6. Foundations: the three-column structure, circular line icons, tinted headings, and darker surface are preserved with Starlight's existing icon set.
7. Safety and participation: the safety band remains visually distinct and the final CTA keeps the centered lime action. The implementation is taller because it includes truthful participation details and a public-design disclaimer.

Measured implementation section boundaries at the native target width:

- Header: `0–78`
- Hero: `78–492`
- Connection image: `492–882`
- Principles: `882–1189`
- Foundations: `1189–1525`
- Safety: `1525–1672`
- Participation: `1672–2093`

## Above-the-fold copy differences

- H1 remains exactly: `地域ごとの違いを残したまま、つながる。`
- The concept lead was expanded to identify `地域や組織の自治` and `共通プロトコル`, matching the source design documents.
- `3分で知る` became `概要を知る` because no measured three-minute reading guarantee exists.
- `EN` became `EN Docs` because `/en/` is the English documentation root, not an equivalent English LP.

## Intentional deviations

- The existing favicon geometry is used for the brand mark instead of shipping the provisional concept logo.
- The terrain visual is a generated production asset rather than a cropped concept screenshot.
- `フォーク可能性` is described as a design principle, not as a legal reuse promise, because the repository license is still `TBD`.
- The page is longer than the static concept to support real responsive copy, a precise GitHub participation route, and the unfinished-design disclaimer.
- Mermaid was removed from the public landing page only. Mermaid documents and the integration remain available under `/diagrams/`.

## Responsive, interaction, and accessibility checks

- Checked viewports: `1440 × 900`, `864 × 1100`, `390 × 844`, plus breakpoint checks at widths `320`, `721`, `780`, and `781`.
- No horizontal overflow at any checked width, including `320px`.
- Desktop navigation remains single-line at `781px` and above; mobile navigation is used at `780px` and below.
- Mobile H1 uses deliberate three-line wrapping; CTAs stack and remain practical tap targets.
- Mobile `details/summary` menu opens and exposes all navigation links.
- `概要を知る` sets `#overview` and places the target below the header.
- `/docs/` loads the Starlight documentation home.
- `/diagrams/00-world-design-overview/` retains one Mermaid container and one rendered Mermaid SVG.
- GitHub participation and English documentation links point to their real destinations.
- Skip link, semantic headings and regions, image alt text, focus-visible states, and reduced-motion handling are present.
- Browser console warnings/errors on the LP: none.

## Build verification

- `volta run --node 24.18.0 npm run build`
- Result: 95 static pages built successfully.
- Existing warning: Mermaid documentation bundles include chunks larger than 500 kB; this is not introduced by the LP.

final result: passed
