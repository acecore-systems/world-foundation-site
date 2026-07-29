# Vectorize 意味検索 運用ガイド

World Foundation Site の検索は、次の 2 系統を同じ検索モーダルで提供します。

- Pagefind: ブラウザ内で動くキーワード検索。常に主検索として残す。
- Cloudflare Vectorize: Workers AI の多言語 embedding を使う「関連する内容」。失敗時はこの欄だけを隠し、Pagefind を継続する。

Vectorize を AI 回答生成には使いません。公開済み設計資料の候補を返す検索補助として扱います。

## 構成

1. `scripts/sync-content.mjs` が原典を同期し、公開 route と原典 commit を `.vectorize/content-manifest.json` に記録する。
2. Astro と Starlight が静的サイトと Pagefind index を `dist/` に生成する。
3. `scripts/build-search-corpus.mjs` が公開 HTML から本文を抽出し、`.vectorize/corpus.json` を生成する。
4. `scripts/sync-vectorize.mjs` が既存 ID と比較し、新規・変更 chunk だけを Workers AI で embedding して upsert する。
5. corpus から消えた ID を削除し、最後の mutation が検索可能になるまで待つ。
6. Pages Function `/api/search` が query を同じ model で embedding し、表示中の言語 namespace を検索する。

公開書き込み API はありません。index 更新は protected `main` 上の GitHub Actions、または権限を持つ運用端末からのみ実行します。

## Cloudflare リソース

| 環境 | Vectorize index | D1 rate-limit database | namespace |
| --- | --- | --- | --- |
| Preview | `world-foundation-search-preview` | `world-foundation-search-preview` | `ja`, `en` |
| Production | `world-foundation-search-production` | `world-foundation-search-production` | `ja`, `en` |

embedding contract は次のとおりです。

- model: `@cf/baai/bge-m3`
- dimensions: `1024`
- metric: `cosine`
- chunk: 850 文字目標 / 1200 文字上限 / 120 文字 overlap

model、dimensions、metric は既存 index 内で混在させません。変更時は新しい index を作成し、全件同期と検索評価を終えてから binding を切り替えます。

Pages 設定は `wrangler.jsonc` を source of truth とします。導入前の Dashboard 設定は `wrangler pages download config world-foundation-site` で取得し、project 名、output directory、compatibility date、空の production environment だけであることを確認済みです。

Production の `SEARCH_ENABLED` は初期状態で `"false"` にします。Preview 同期と検索評価、Production index の事前同期、Pages binding の確認がすべて終わるまで公開 API を有効化しません。

## 原典と公開 build の一致

World Foundation は site repo と原典 repo が分かれています。公開 marker
`/.well-known/world-foundation-build.json` には次を記録します。

- `siteCommit`: `world-foundation-site` の commit
- `contentCommit`: `world-foundation` の commit
- `searchCorpusVersion`: chunk ID 集合から作る corpus version

production 同期は、公開 marker が示す両 commit を checkout して corpus を再生成し、同期直前にも公開 marker と 3 値が一致する場合だけ実行します。site の push 後に Pages deployment が失敗した場合や、build 中に原典の公開状態が変わった場合は index を更新しません。

原典だけが更新された場合は、既存の Pages Deploy Hook がサイトを再構築し、15 分ごとの reconciler が新しい公開 marker へ index を収束させます。

## GitHub Actions と secret

`.github/workflows/sync-vectorize.yml` は次を提供します。

- Pull Request: secret なしで build、検索テスト、型検査、Pages Functions bundle、同期 dry-run を検証。
- `main` push: 対応する production Pages deployment を待って production index を同期。
- 15 分ごと: 現在公開中の site/content commit を再構築して production index を調整。
- 手動 `preview`: 最新 `main` と原典 `main` を preview index へ同期。
- 手動 `production`: 現在公開中の組み合わせを production index へ再同期。

実 corpus を作る job と token を使う同期 job は runner を分けます。同期 job は同じ protected `main` commit の依存なしスクリプトを再 checkout し、artifact の site/content/corpus 3 値を検証してから、最後の step だけへ token を渡します。

GitHub Environments と environment secret は次のように分離します。

| GitHub Environment | Environment secret | 同期先 |
| --- | --- | --- |
| `cloudflare-world-foundation-search-preview` | `CLOUDFLARE_SEARCH_PREVIEW_API_TOKEN` | preview index |
| `cloudflare-world-foundation-search-production` | `CLOUDFLARE_SEARCH_PRODUCTION_API_TOKEN` | production index |

両 Environment の Deployment branches and tags は `main` だけに制限します。token は Acecore account だけを resource に指定し、同期に必要な `Vectorize Read`、`Vectorize Write`、`Workers AI Read` だけを付与します。token 値を repo、設定、ログ、PR 本文へ書きません。secret は build へ渡さず、fresh runner の最終同期 step だけに渡します。

Cloudflare の Vectorize 権限は account scope で、個別 index には制限できません。GitHub Environment と同期 CLI の target 固定は誤操作を防ぎますが、Preview token 自体の権限範囲には同じ account の Production index も含まれます。完全な hard isolation が必要な場合は、別 account または狭い同期 gateway が必要です。

専用 token を Environment secret へ保存する前に、`main` へ最低 1 件の承認、last-push approval、この workflow の PR 検証を required check として設定します。可能なら workflow と `scripts/sync-vectorize.mjs` を CODEOWNERS の対象にもします。secret-bearing job は protected `main` のコードを実行するため、自己承認だけで `main` を変更できる状態では token を保存しません。

Pages Preview の binding は全 preview branch で共有されます。共有 Preview index は protected `main` の corpus だけを入れ、PR ごとの corpus で交互に上書きしません。

## 手元での検証

Node.js は `.node-version` のバージョンを使います。

```powershell
volta run --node 24.18.0 npm ci
$env:WORLD_FOUNDATION_SOURCE = 'C:\Users\gnish\repos\world-foundation'
volta run --node 24.18.0 npm run build
volta run --node 24.18.0 npm run test:search
volta run --node 24.18.0 npm run types:cloudflare:check
volta run --node 24.18.0 npm run check:pages-config
volta run --node 24.18.0 npm run typecheck:functions
volta run --node 24.18.0 npm run sync:vectorize:dry-run
```

Preview deployment を同期後に評価する場合は、23 件の固定 fixture を使います。同じ session ID のまま 20 件目で固定窓の終了を待ち、通常の 20 回/分 client 制限を迂回せず全件を評価します。

```powershell
volta run --node 24.18.0 npm run evaluate:search -- --origin https://<preview-deployment>.world-foundation-site.pages.dev
```

合格条件は expected route の top 3 率 60% 以上、alternate を含む許容 top 3 率 80% 以上、各言語の許容 top 3 率 70% 以上、API error 0 件です。

Pages binding を含むローカル確認では、先に local D1 へ migration を適用します。

```powershell
volta run --node 24.18.0 npx wrangler d1 migrations apply world-foundation-search-preview --local
volta run --node 24.18.0 npx wrangler pages dev --env preview
```

`AI` と `SEARCH_INDEX` は `remote: true` です。ローカル確認でも実際の Preview index を参照し、Workers AI の利用量が発生します。

remote D1 migration は deployment より先に明示適用し、未適用がないことを再確認します。

```powershell
volta run --node 24.18.0 npx wrangler d1 migrations apply world-foundation-search-preview --remote --env preview
volta run --node 24.18.0 npx wrangler d1 migrations apply world-foundation-search-production --remote --env production
volta run --node 24.18.0 npx wrangler d1 migrations list world-foundation-search-preview --remote --env preview
volta run --node 24.18.0 npx wrangler d1 migrations list world-foundation-search-production --remote --env production
```

## 同期の安全策

- 同期先 index 名は World Foundation の preview / production 2 件だけを許可する。
- Cloudflare account ID を Acecore account に固定し、`--target` から index 名を決定する。
- Production 同期は corpus version と一致する `--confirm-production` を必須にする。
- index は同期処理で自動作成せず、事前作成済みの dimensions / metric を検証する。
- corpus の source 数、vector 数、言語別 vector 数が安全下限を下回る場合は停止する。
- 管理外形式の vector ID が 1 件でもあれば mutation 前に停止する。
- 既存 vector の 20% を超える削除は、`--allow-large-delete` の明示なしでは停止する。
- 内容ハッシュ付き ID により、同じ corpus の再同期では embedding を作り直さない。
- vector ID は embedding model、dimensions、metric、chunk contract を含む。契約変更時は全 ID が変わり、大量削除 guard が明示確認を要求する。
- upsert 後に stale ID を削除し、最終 ID 集合が corpus と完全一致するまで検証する。Cloudflare の一時的な 429 / 5xx / network error は上限付き backoff で再試行する。
- raw query、IP、embedding はログへ残さない。

## API の安全境界

- 同一 Origin の `application/json` POST だけを受け付ける。
- body は 2 KiB、query は 2〜160 文字、`topK` と model は server 側で固定する。
- client 20 回/分、全体 300 回/分の固定窓を D1 で fail-closed に適用する。
- client key はブラウザの session UUID を SHA-256 化して使い、接続 IP は rate limit DBへ使わない。期限切れ row は各検索の前に削除する。
- session UUID は利用者が変更できるため、client 制限だけを費用上限とはみなさない。全体制限も必ず有効化し、公開後は Workers AI 利用量と 429 を監視する。必要になった場合は Turnstile や Cloudflare の edge rate-limit を追加する。
- metadata の URL は同一 Origin の root-relative 公開 route だけを許可する。
- response は `Cache-Control: no-store`。runtime log は request ID、stage、error class だけを記録する。
- `SEARCH_ENABLED` を `"false"` にすると、UI と Pagefind を壊さず意味検索 API を停止できる。

## 障害対応

1. Pagefind のキーワード検索が動くことを確認する。
2. `/api/search` の status と `X-Search-Request-Id` を確認する。
3. Pages Functions の runtime log を request ID で追う。query 本文は記録されない。
4. Workers AI、Vectorize、D1 の障害時は `SEARCH_ENABLED` を `"false"` にして再 deploy する。
5. index を作り直す場合は新 index の同期と canary を終えてから binding を切り替える。旧 index を先に削除しない。

## Production 有効化 gate

1. Preview D1 migration、Preview index 同期、固定 fixture 評価を完了する。
2. Production D1 migration を確認し、`SEARCH_ENABLED="false"` のまま同じ corpus を Production index へ同期する。
3. GitHub-connected Pages deployment で `uses_functions=true`、Wrangler config hash、AI / Vectorize / D1 binding を確認する。
4. `SEARCH_ENABLED="true"` へ変える小さな Pull Request を別に作成する。
5. 公開 `/api/search` の日英 canary と Pagefind fallback を確認する。失敗時は直ちに `"false"` へ戻す。

## 公式資料

- [Vectorize client API](https://developers.cloudflare.com/vectorize/reference/client-api/)
- [Vectorize limits](https://developers.cloudflare.com/vectorize/platform/limits/)
- [Vectorize insert best practices](https://developers.cloudflare.com/vectorize/best-practices/insert-vectors/)
- [BGE-M3](https://developers.cloudflare.com/workers-ai/models/bge-m3/)
- [Pages Functions bindings](https://developers.cloudflare.com/pages/functions/bindings/)
- [Pages Wrangler configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)
- [D1](https://developers.cloudflare.com/d1/)
