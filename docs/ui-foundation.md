# UI Foundation

World Foundation Site の UI は Tailwind CSS v4 を唯一のビルド基盤として使う。設定は JavaScript の Tailwind config ではなく、`src/styles/tailwind.css` の CSS-first 構成に集約する。

## 読み込み経路

- Astro/Vite: `@tailwindcss/vite` を `astro.config.mjs` で有効化する。
- Starlight: 同じ entry を `customCss` に指定し、`@astrojs/starlight-tailwind` で Starlight のトークンと Tailwind のレイヤーを接続する。
- Cinematic landing と 404: 同じ entry を各ルートから import する。

これにより、ランディング、文書、検索、404 が別々の CSS 基盤を持たない。

## レイヤーと Preflight

`src/styles/tailwind.css` は `base, starlight, theme, components, utilities` の順序を固定する。完全な Tailwind Preflight は導入しない。既存 Starlight の文書 reset・見出し・フォーム UI への影響が大きく、今回の目的である見た目を変えない移行と両立しないためである。

代わりに `@astrojs/starlight-tailwind` を使い、Starlight と Tailwind が共通で必要とする最小限の base rules とトークン連携だけを有効にする。Preflight を将来採用する場合は、全ドキュメント面・検索ダイアログ・404・キーボード操作を再検証する独立変更として扱う。

## トークン

`@theme` に定義した値を優先し、色や書体をテンプレート中の任意値で重複させない。

| 領域 | Tailwind token |
| --- | --- |
| Cinematic background | `wf-ink`, `wf-ink-soft`, `wf-midnight`, `wf-slate` |
| Cinematic foreground | `wf-ivory`, `wf-ivory-bright`, `wf-brass`, `wf-rust`, `wf-glass` |
| Typography | `font-wf-serif`, `font-wf-sans`, `font-wf-system` |
| Standalone 404 | `wf-404-canvas`, `wf-404-text`, `wf-404-muted`, `wf-404-link` |

ランディング固有の `--rule`、`--rule-soft`、`--rail-width` は、CQi ベースの既存ジオメトリを維持するため `html.wf-landing` に限定する runtime token であり、他画面の汎用トークンにしない。

## 実装規約

1. 新しい静的 UI は Tailwind utility をテンプレートで明示して実装する。
2. 繰り返す複合パターンは `tailwind.css` の適切な cascade layer で `@apply` を使い、コンポーネント内の global `<style>` を増やさない。
3. 既存 cinematic landing の参照ジオメトリは視覚差分を出さないため同じ entry の `@layer components` に置く。背景アートの gradient、疑似要素、container query、reduced motion など utility 化すると意味や可読性を損なう宣言も同じ層に閉じ込める。
4. 動的に組み立てた class 名に依存しない。Tailwind が検出できる静的 utility か、意味のある component class を使う。
5. `wf-landing` 外へ generic reset や色を漏らさない。Starlight 用の検索 styles は `@layer starlight.core` に置く。

## アクセシビリティと確認

- `:focus-visible`、skip link、キーボード操作、`prefers-reduced-motion` を削除・弱体化しない。
- ランディングは desktop と mobile、文書と 404 は少なくとも一画面で描画確認する。
- 変更前に `npm run build`、`npm run test:search`、`npm run typecheck:functions` を実行する。worktree で content source を明示する場合は `WORLD_FOUNDATION_SOURCE` を既存 Markdown リポジトリへ設定する。
