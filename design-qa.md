# Design QA

## Comparison target

- Source visual truth: `C:\Users\gnish\.codex\visualizations\2026\07\27\019fa0f9-045d-7ea2-b9a9-36014ddbad57\fidelity-audit-2026-07-27\01-reference.png`
- Rendered implementation: `http://127.0.0.1:4173/`
- Final implementation capture: `C:\Users\gnish\.codex\visualizations\2026\07\27\019fa0f9-045d-7ea2-b9a9-36014ddbad57\fidelity-audit-2026-07-27\02-current-final.png`
- Final side-by-side comparison: `C:\Users\gnish\.codex\visualizations\2026\07\27\019fa0f9-045d-7ea2-b9a9-36014ddbad57\fidelity-audit-2026-07-27\03-reference-vs-current-final.jpg`
- Responsive evidence:
  - `04-mobile-390.png`
  - `05-english-821.png`
  - `06-desktop-1440.png`

## Viewport and geometry

- Reference and implementation were compared at exactly `861 × 1827` CSS pixels with device scale factor 1.
- Final page geometry is `861 × 1827`; horizontal scroll width is `861`.
- Section boundaries match the reference at `0, 310, 500, 693, 782, 977, 1170, 1357, 1495, 1644, 1827`.
- The left timeline boundary, marker track, chapter positions, scene cuts, evidence band, and epilogue height were measured rather than visually approximated.

## Final findings

- No actionable P0, P1, or P2 fidelity issue remains.
- Hero, ACT I, and epilogue use slot-specific cinematic assets with copy-safe shadow fields and reference-matched focal placement.
- ACT II uses the approved membrane/intercellular-fluid abstraction for “ひとつの世界。無数の自由。” rather than a literal map or sunrise.
- ACT IV now includes the reference’s public-design worktable density: paper, window light, glass, and a visible vintage camera.
- ACT V uses multiple small silver-black liquid pools instead of one dominant blob; the quote and `— Accepted` remain fully inside the section.
- Evidence values, 10 principles, 11 modules, six roadmap phases, and the Issue → Proposal → Review → Decision → Fork process retain their information density.
- Japanese timeline copy matches the selected reference: `世界をひとつにしない`, `安全設計`, `愛される`, and `育てる つながる`.
- Section-average luminance is within a small visual tolerance of the reference; the largest remaining difference is local image texture, not layout or readability.

## Responsive and locale QA

- Checked widths: `390`, `820`, `821`, `861`, and `1440` CSS pixels.
- No horizontal overflow was found at any checked width.
- Mobile uses the intended single-column cinematic sequence with full-width controls and readable information blocks.
- The source-matched Japanese composition starts at `861`; narrower widths keep the roomier responsive layout instead of shrinking labels and descriptions below a readable size.
- English was checked at `390`, `821`, `861`, and `1440`. It retains the content-first single-column story layout at every width, without the Japanese chapter rail; up to `1080`, the eleven modules use one readable column with no clipped or mid-word-broken descriptions.
- JP/EN language switching returns the correct route, `lang`, and document title.

## Interaction and browser QA

- The hero CTA was located as one unique accessible link, clicked, and verified to land at `#act1` with the section at viewport top.
- The external participation CTA opens the repository issues page in a new tab with `rel="noreferrer"`.
- The final browser pass found zero broken scene images and no console warnings or errors.
- Semantic regions, heading order, skip link, visible links, reduced-motion behavior, and decorative-image handling remain intact.
- Native scrollbars remain visible on English and below `861`. On the source-matched Japanese layout at `861` and wider, they are visually hidden to preserve the exact content canvas; wheel, touch, and keyboard scrolling remain available and the chapter rail supplies position context. This is an intentional P3 fidelity trade-off, not an interaction blocker.

## Production verification

- Command: Node `24.18.0`, `WORLD_FOUNDATION_SOURCE=C:\Users\gnish\repos\world-foundation`, `npm run build`.
- Result: passed.
- Content sync: 94 pages.
- Static build: 97 pages.
- Pagefind index and sitemap completed.
- One non-blocking existing Vite warning remains for a chunk larger than 500 kB; it is unrelated to the landing-page fidelity work.

## Comparison history

1. Initial comparison exposed incorrect full-page height, repeated timeline markers, missing media, and oversized dark sections.
2. Geometry was rebuilt around one measured timeline and the exact reference section boundaries.
3. Evidence, principles, modules, safety, life, roadmap, and epilogue typography were resized against same-viewport captures.
4. Hero, ACT I, ACT IV, ACT V, and epilogue received slot-specific generated backgrounds.
5. Final same-size comparison, responsive QA, locale QA, interaction checks, console inspection, and the 97-page production build passed.
6. A stricter follow-up review caught translated typography falling to `6–8px` and an empty desktop rail; the exact layout was limited to Japanese from `861px`, English keeps a full-width content-first layout, and scrollbar hiding was limited to the Japanese exact-layout regime.

final result: passed
