# Design QA

## Comparison target

- Source visual truth: `C:\Users\gnish\.codex\generated_images\019fa0f9-045d-7ea2-b9a9-36014ddbad57\call_z5GE7SkUHWk6KCoBT91QUAij.png`
- Rendered implementation: `http://127.0.0.1:4173/`
- Full-view implementation evidence: `C:\Users\gnish\.codex\visualizations\2026\07\27\019fa0f9-045d-7ea2-b9a9-36014ddbad57\lp-overview-final.jpg`
- Side-by-side comparison: `C:\Users\gnish\.codex\visualizations\2026\07\27\019fa0f9-045d-7ea2-b9a9-36014ddbad57\reference-vs-prototype.jpg`
- Focused evidence:
  - `C:\Users\gnish\.codex\visualizations\2026\07\27\019fa0f9-045d-7ea2-b9a9-36014ddbad57\focus-hero-1440.jpg`
  - `C:\Users\gnish\.codex\visualizations\2026\07\27\019fa0f9-045d-7ea2-b9a9-36014ddbad57\focus-principles-861.jpg`
  - `C:\Users\gnish\.codex\visualizations\2026\07\27\019fa0f9-045d-7ea2-b9a9-36014ddbad57\focus-mobile-390.jpg`
- State: Japanese landing page, dark cinematic theme, default motion; English route checked separately.

## Viewport and normalization

- Source: 861 × 1827 px, treated as 1× design overview.
- Browser checks: 1440 × 900, 861 × 900, and 390 × 844 CSS px.
- The in-app browser reserved 15 px for its scrollbar, producing 1425 px, 846 px, and 375 px content widths.
- The implementation overview combines eight 846 × 900 viewport captures into an 846 × 1800 contact view. It was normalized to 861 × 1827 only for the combined comparison image. Focused screenshots retain their browser-rendered density and were used for readable typography and crop checks.

## Findings

- No actionable P0, P1, or P2 differences remain.
- Typography: Noto Serif JP carries the cinematic display hierarchy while Noto Sans JP is limited to utility labels. Weight, tracking, wrapping, and line height remain readable at all checked widths.
- Spacing and layout rhythm: the left act rail, alternating image/copy fields, evidence band, and epilogue preserve the selected composition. Desktop and mobile checks showed no horizontal overflow, overlap, or clipped controls.
- Colors and tokens: charcoal, midnight blue, ivory, brass, and restrained rust match the selected visual direction. Brighter cellular, rainy-day, archipelago, and single-sunrise scenes prevent the page from becoming uniformly dark.
- Image quality: nine 2048 × 1152 production assets are present and loaded. The selected membrane/intercellular-fluid abstraction is used for “ひとつの世界。無数の自由。” No visible asset is replaced with placeholder, CSS art, inline SVG art, emoji, or a text glyph.
- Copy and content: the page retains 10 principles, 11 modules, 26 threat categories, and 6 roadmap phases. It states one shared world with autonomous communities, omits founder/Acecore promotion, and keeps the detailed public-design content.
- Interaction and accessibility: JP/EN switching works; primary documentation routes return HTTP 200; the page includes a skip link, semantic headings/regions, visible focus treatment, decorative-image alt handling, and reduced-motion behavior.
- Browser evidence: all scene images reported natural size 2048 × 1152, no broken images were found, and the browser console contained no warnings or errors.

## Comparison history

### Pass 1 — blocked

- [P1] ACT III, ACT IV, and ACT VI scene images were hidden behind the panel background.
  - Evidence: the first 861 px overview showed uninterrupted black fields where the selected visual had image/copy splits.
  - Cause: negative `z-index` from `.scene-media` escaped the editorial media container.
  - Fix: isolated `.editorial-split__media`, clipped it, promoted its image to `z-index: 0`, and placed the gradient overlay at `z-index: 1`.

### Pass 2 — passed

- Post-fix evidence: `focus-principles-861.jpg` shows the pen-and-membrane scene beside the 10 principles, followed by the collaborative worktable beside the 11 modules.
- The refreshed full-view comparison shows the intended image rhythm through ACT VI with no remaining P0/P1/P2 visual difference.

### Pass 3 — passed

- Independent review found that locale fallback exposed the Japanese overview at `/en/docs/overview/`; the sync map now generates an English overview from `docs/en/README.md`.
- Independent review found that ACT V skipped from its section label directly to `h3`; the ACT V label is now its semantic `h2` without changing the visual treatment.
- The English overview and ACT V heading level were rechecked in the in-app browser. The final 97-page production build completed successfully.

## Open Questions

- None blocking. The source is a condensed visual overview while the implementation is a usable scrolling site, so exact section height equality is intentionally not treated as a fidelity requirement.

## Implementation Checklist

- [x] Match the approved cinematic direction.
- [x] Use the selected abstract cellular background.
- [x] Preserve the full information architecture and source-backed figures.
- [x] Provide Japanese and English landing pages.
- [x] Keep documentation routes available after replacing the generated home routes.
- [x] Verify desktop, tablet-width, and mobile layouts.
- [x] Verify language switching, core links, image loading, and browser console.
- [x] Complete a 97-page production build.

## Follow-up Polish

- [P3] A future performance pass could split the existing Mermaid documentation bundle. It does not affect the LP’s visual fidelity or core interaction.

final result: passed
