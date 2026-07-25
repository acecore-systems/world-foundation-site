# Design QA: World Foundation LP option 2

## Visual target and capture method

- Accepted concept: `C:\Users\gnish\.codex\generated_images\019f93a2-e933-7443-93b6-9d02039547ad\call_nv3fCrxDA8jN2wL5sbu7b1qk.png`
- Concept native size: `864 × 1821`
- Browser method: Codex in-app browser against the static production build at `http://127.0.0.1:4399/`
- Screenshot method: in-app browser viewport screenshots with `tab.screenshot({ fullPage: false })`
- Full-page fallback: the in-app browser full-page capture tiled the page incorrectly, so the page was checked with top, middle, and bottom viewport captures plus DOM section measurements.
- Latest implementation screenshot: `C:\Users\gnish\.codex\visualizations\2026\07\24\019f93a2-e933-7443-93b6-9d02039547ad\qa-world-foundation-lp-fix2\final-864x1100.png`
- Latest source/implementation comparison: `C:\Users\gnish\.codex\visualizations\2026\07\24\019f93a2-e933-7443-93b6-9d02039547ad\qa-world-foundation-lp-fix2\comparison-reference-final-responsive-864.png`
- Above-the-fold before/after comparison: `C:\Users\gnish\.codex\visualizations\2026\07\24\019f93a2-e933-7443-93b6-9d02039547ad\qa-world-foundation-lp-fix2\comparison-before-final-1280x720.png`
- Latest fault-geometry implementation screenshots: `C:\Users\gnish\.codex\visualizations\2026\07\24\019f93a2-e933-7443-93b6-9d02039547ad\qa-world-foundation-landscape-v2\final-browser-864x1100.png`, `final-browser-1280x720.png`, and `final-browser-390x844.png`
- Fault-geometry source/current/final comparison: `C:\Users\gnish\.codex\visualizations\2026\07\24\019f93a2-e933-7443-93b6-9d02039547ad\qa-world-foundation-landscape-v2\comparison-target-current-final.png`
- `view_image` inspection completed for the accepted concept, latest implementation screenshot, and combined comparison image.
- Source pixels: `864 × 1821`. Implementation pixels: `849 × 1081` for the `864 × 1100` CSS viewport and `1265 × 712` for the `1280 × 720` CSS viewport. Browser `devicePixelRatio` was `1`; no density resampling was required. The in-app browser capture excludes its scrollbar/chrome from the saved bitmap.

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
- The terrain visual now uses an exact production crop from the accepted concept, exported separately from the surrounding mockup UI.
- `フォーク可能性` is described as a design principle, not as a legal reuse promise, because the repository license is still `TBD`.
- The page is longer than the static concept to support real responsive copy, a precise GitHub participation route, and the unfinished-design disclaimer.
- Mermaid was removed from the public landing page only. Mermaid documents and the integration remain available under `/diagrams/`.

## Follow-up iteration: first-view imagery

**Earlier finding**

- `[P1]` At the reported `1280 × 720` viewport, the initial implementation ended the hero at `y = 764`, so the connection image had `0px` visible above the fold. The H1 was approximately `81px`, and the `88px` header plus generous hero padding made the page feel like a text-only introduction. This materially diverged from the accepted concept's image-led LP hierarchy.

**Fix**

- Reduced the desktop header from `88px` to `80px`.
- Added a desktop-only compact hero scale: `56–72px` top padding, `56–80px` bottom padding, a `57.6–76.8px` H1 range, tighter body rhythm, and `58px` CTA height.
- Kept the accepted `864px` composition unchanged at the important section boundary: the hero still ends and the connection image still begins at `y = 492`.

**Post-fix evidence**

- At `1280 × 720`, the hero now ends at `y = 474`; `246px` of the connection image is visible in the first viewport. The H1 is approximately `67px`, while its two-line hierarchy remains intact.
- At `1920 × 1034`, `494px` of the connection image is visible above the fold.
- At `864 × 1100`, the hero/image boundary remains `y = 492`, matching the accepted concept.
- At `390 × 844`, `229px` of the image is visible and the central connection glow reaches the first viewport; at `320 × 800`, `226px` is visible, the mobile H1 remains three deliberate lines, the lead has no orphaned final character, and there is no horizontal overflow.
- Fluid section sizing reduced the `1000px` → `1001px` document-height discontinuity from `541px` to `36px`; the connection image changes from `390px` to `390.34px` across that boundary.
- The combined `1280 × 720` before/after image was inspected directly. The revised state visibly changes the first screen from text-only to the intended headline → CTA → connection-landscape sequence.
- The combined `864px` reference/final image was also inspected directly. No actionable P0/P1/P2 differences remain across typography, spacing, colors, image quality, or copy. The remaining copy and logo differences are the intentional product constraints listed above.
- A focused region comparison was not needed: the user-reported defect concerned the full first-view composition, and all critical headline, CTA, and image details are legible in the normalized full-view comparisons.

## Responsive, interaction, and accessibility checks

- Checked viewports: `1920 × 1034`, `1440 × 900`, `1280 × 720`, `1001 × 720`, `1000 × 720`, `864 × 1100`, `390 × 844`, and `320 × 800`, plus breakpoint checks at widths `721`, `780`, and `781`.
- No horizontal overflow at any checked width, including `320px`.
- Desktop navigation remains single-line at `781px` and above; mobile navigation is used at `780px` and below.
- Mobile H1 uses deliberate three-line wrapping; CTAs stack and remain practical tap targets.
- Mobile `details/summary` menu opens and exposes all navigation links.
- `概要を知る` sets `#overview` and places the target below the header.
- Follow-up interaction proof at `1280 × 720`: exactly one `概要を知る` link was found; activating it set `#overview`, scrolled to `scrollY = 386`, and placed the target at approximately `88px` from the viewport top.
- `/docs/` loads the Starlight documentation home.
- `/diagrams/00-world-design-overview/` retains one Mermaid container and one rendered Mermaid SVG.
- GitHub participation and English documentation links point to their real destinations.
- Skip link, semantic headings and regions, image alt text, focus-visible states, and reduced-motion handling are present.
- Browser console warnings/errors on the LP: none. The only console entry was the expected informational message that no Mermaid diagrams exist on the landing page.

## Follow-up iteration: fault geometry

**Earlier finding**

- `[P1]` The first production landscape added several independent hills and dips across the green, cyan, blue, and purple boundaries. The accepted concept uses one broad, shallow central basin above the connection and one broad, shallow central rise below it; the outer thirds remain nearly horizontal. The production image therefore felt substantially more distorted than the source.

**Fix**

- Rebuilt the landscape from the accepted concept crop as the geometry reference while retaining the existing lime, cyan, blue, purple, topographic, and network textures.
- Removed the secondary side waves and kept one continuous central dip/rise.
- Trimmed the generated source by `42px` at the top so the green terrain reaches the upper edge at both sides while the dark gap remains shallow only around the center.
- Exported a production WebP at `1824 × 862`, quality `85`, as `/public/lp/connection-landscape-v2.webp`.
- Kept the previous `/public/lp/connection-landscape.webp` asset unchanged for rollback.

**Post-fix evidence**

- The three-way source/current/final comparison was inspected directly. The old middle image visibly contains multiple waves; the final image returns to one shallow central basin and one central rise.
- Exact CSS `object-fit: cover` crops were reproduced and inspected at the accepted `864px` width and the reported `1280px` desktop width: `comparison-target-final-css-crop-864.png` and `comparison-target-final-css-crop-1280.png`.
- The actual built page was captured and inspected in the in-app browser at `1280 × 720`, `864 × 1100`, and `390 × 844`. The revised terrain is visible above the fold on desktop and mobile, remains centered, and does not introduce a second silhouette wave.
- The focused mobile crop preserves the single basin/rise. Its narrower viewport naturally removes the long horizontal shoulders, but it does not reintroduce the previous multi-wave shape.
- Typography, spacing, copy, controls, and section boundaries are unchanged by this iteration; only the landscape source asset changed.
- Remaining differences from the concept are non-material texture/color variations: the final green is slightly more yellow, the purple slightly more saturated, and the glow edge slightly thinner toward the sides.

## Follow-up iteration: exact source fidelity

**Earlier finding**

- `[P2]` The geometry-only v2 correction removed the extra waves, but it was still a regenerated interpretation. Compared directly with the accepted concept, its green and purple were more saturated, the white glow was stronger, the texture paths differed, and `object-fit: cover` removed the green upper boundary on wide screens. The result therefore still looked slightly different even though the broad silhouette was correct.

**Fix**

- Extracted the accepted concept's terrain directly from `y = 490` at its native `864 × 392` source size.
- Upscaled that exact crop by `2×` with Lanczos resampling and exported `/public/lp/connection-landscape-v3.webp` at `1728 × 784`, WebP quality `92`.
- Matched the desktop/tablet container to the source ratio with `aspect-ratio: 864 / 392`; the image no longer loses its upper or lower boundary at wide viewports.
- Preserved the existing focused mobile crop at `640px` and below so the central connection remains legible in the first viewport.
- Kept both earlier production assets unchanged for rollback.

**Post-fix visual evidence**

- Source visual truth: `C:\Users\gnish\.codex\generated_images\019f93a2-e933-7443-93b6-9d02039547ad\call_nv3fCrxDA8jN2wL5sbu7b1qk.png`
- Focused same-size comparison: `C:\Users\gnish\.codex\visualizations\2026\07\24\019f93a2-e933-7443-93b6-9d02039547ad\qa-world-foundation-landscape-v3\comparison-reference-implementation-864.png`
- Browser implementation captures: `final-ratio-browser-864x1100.png`, `final-ratio-browser-1280x720.png`, `final-ratio-browser-1920x1034.png`, and `final-ratio-browser-390x844.png` in the same QA directory.
- At the `864 × 1100` CSS viewport, the source region is `864 × 392`; the browser content is `849px` wide and renders the terrain at `848.67 × 385.04` CSS pixels. The focused comparison normalizes both sides to `849 × 385`.
- Browser `devicePixelRatio` reported `1.5`; the in-app screenshot output uses the browser content pixel size, so the focused evidence was normalized to the implementation bitmap rather than compared at mixed density.
- At `1280 × 720`, the real asset loaded at natural size `1728 × 784` and rendered at `1264.67 × 573.78`; `scrollWidth` equals `clientWidth` (`1265px`).
- At `1920 × 1034`, the full upper green boundary remains visible instead of being vertically cropped away.
- At `390 × 844`, the existing mobile crop keeps the central valley visible above the fold; `scrollWidth` equals `clientWidth` (`375px`).
- Responsive checks at `1001`, `1000`, `781`, `780`, `390`, and `320px` found complete image loading and no horizontal overflow.
- Required fidelity surfaces: typography, copy, controls, icons, colors outside the image, and section order are unchanged. The terrain now matches the source crop, palette, texture, light band, and silhouette directly. No actionable P0/P1/P2 differences remain.

## Build verification

- `volta run --node 24.18.0 npm run build`
- Result: 95 static pages built successfully.
- Existing warning: Mermaid documentation bundles include chunks larger than 500 kB; this is not introduced by the LP.

final result: passed
