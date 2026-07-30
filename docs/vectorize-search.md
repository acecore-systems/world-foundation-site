# Vectorize 意味検索 運用ガイド

World Foundation Site の検索は、次の 2 系統を同じ検索モーダルで提供します。

- Pagefind: ブラウザ内で動くキーワード検索。常に主検索として残す。
- Cloudflare Vectorize: Workers AI の多言語 embedding を使う「関連する内容」。失敗時はこの欄だけを隠し、Pagefind を継続する。

Vectorize を AI 回答生成には使いません。公開済み設計資料の候補を返す検索補助として扱います。

## 構成

1. `scripts/sync-content.mjs` が原典を同期し、公開 route と原典 commit を `.vectorize/content-manifest.json` に記録する。
2. Astro と Starlight が静的サイトと Pagefind index を `dist/` に生成する。
3. `scripts/build-search-corpus.mjs` が公開 HTML から本文を抽出し、`.vectorize/corpus.json` を生成する。
4. `scripts/sync-vectorize.mjs` が全 chunk を Workers AI で再 embedding して upsert し、同じ ID の values / metadata 破損も修復する。
5. corpus から消えた ID を削除し、最後の mutation が検索可能になるまで待つ。
6. Pages Function `/api/search` が query を同じ model で embedding し、表示中の言語 namespace を検索する。

公開書き込み API はありません。index 更新は protected `preview` / `main` 上の GitHub Actions からのみ実行します。

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

原典だけが更新された場合は、既存の Pages Deploy Hook がサイトを再構築します。初期リリース中の Production index は自動更新せず、保護済み `preview` branchで評価した後、公開 marker を確認して手動 workflow で同期します。

## GitHub Actions と secret

`.github/workflows/sync-vectorize.yml` は次を提供します。

- Pull Request: secret なしで build、検索テスト、型検査、Pages Functions bundle、同期 dry-run を検証。
- `preview` push: review済み `preview` と原典 `main` を preview index へ同期。
- 手動 `preview`: 最新 `preview` と原典 `main` を preview index へ再同期。
- 手動 `production`: 現在公開中の組み合わせを production index へ再同期。

通常の変更は feature branch から `preview` への Pull Request、Preview deploy / 検索評価、`preview` から `main` への Pull Request の順に進めます。`main` 向けPRは同じrepositoryの `preview` branchだけを許可します。

原典 repository の `main` 更新だけでは site repository の required check は再実行されません。初期リリースでは Production 検索を無効のままにし、`preview` から `main` を merge する直前に検証 workflow を再実行して、artifact、Preview marker、原典 commit が一致することを確認します。将来この運用ゲートをなくす場合は、原典 commit を site commit に記録して Pull Request の入力へ固定します。

初期リリースでは `main` push と定期 schedule から Production 同期を起動しません。Preview 評価、Production 事前同期、公開 canary を完了した後も、自動同期を有効化する場合は別 Pull Request で同期方式と原子的な corpus 切替をレビューします。

実 corpus を作る job と token を使う同期 job は runner を分けます。同期 job は同じ protected `preview` / `main` commit の依存なしスクリプトを再 checkout し、artifact の site/content/corpus 3 値を検証してから、最後の step だけへ token を渡します。

GitHub Environments と environment secret は次のように分離します。

| GitHub Environment | Environment secret | 同期先 |
| --- | --- | --- |
| `cloudflare-world-foundation-search-preview` | `CLOUDFLARE_SEARCH_PREVIEW_API_TOKEN` | preview index |
| `cloudflare-world-foundation-search-production` | `CLOUDFLARE_SEARCH_PRODUCTION_API_TOKEN` | production index |

Preview Environment の Deployment branches and tags は `preview`、Production Environment は `main` だけに制限します。token は Acecore account だけを resource に指定し、同期に必要な `Vectorize Read`、`Vectorize Write`、`Workers AI Read` だけを付与します。token 値を repo、設定、ログ、PR 本文へ書きません。secret は build へ渡さず、fresh runner の最終同期 step だけに渡します。

Cloudflare の Vectorize 権限は account scope で、個別 index には制限できません。GitHub Environment と同期 CLI の target 固定は誤操作を防ぎますが、Preview token 自体の権限範囲には同じ account の Production index も含まれます。完全な hard isolation が必要な場合は、別 account または狭い同期 gateway が必要です。

`main` は最低 1 件の承認、dismiss stale review、last-push approval、この workflow の PR 検証を必須にします。単独運用中の `preview` は明示承認により required approval を 0、last-push approval を無効にしていますが、Pull Request、strict な必須検証、admin への保護適用、linear history、conversation resolution、force push / branch delete 禁止は維持します。

この `preview` の例外は独立レビューを失う運用リスクです。また Cloudflare の Vectorize token は個別 index に絞れないため、Preview token の account scope には Production index も含まれます。別 reviewer を用意できた時点で `preview` も 1 承認と last-push approval へ戻すか、別 account / 狭い同期 gateway で hard isolation します。可能なら workflow と `scripts/sync-vectorize.mjs` を CODEOWNERS の対象にもします。

Pages Preview の binding は全 preview branch で共有され、Vectorize / D1 binding は読み取り専用ではありません。Cloudflare Pages の Preview branch control は保護済み `preview` だけを許可し、任意の PR branch を Functions 付きで自動 deploy しません。共有 Preview index へは現在の protected `preview` の corpus だけを入れ、過去 workflow の再実行や PR ごとの corpus で上書きしません。

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
- live sync CLI は `GITHUB_ACTIONS=true` を誤操作防止として要求し、通常のローカル worktree では dry-run のみにする。実際の権限境界は GitHub Environment secret、deployment branch policy、branch protection で構成する。
- Cloudflare account ID を Acecore account に固定し、`--target` から index 名を決定する。
- Production 同期は corpus version と一致する `--confirm-production` を必須にする。
- index は同期処理で自動作成せず、事前作成済みの dimensions / metric を検証する。
- corpus の source 数、vector 数、言語別 vector 数が安全下限を下回る場合は停止する。
- 管理外形式の vector ID が 1 件でもあれば mutation 前に停止する。
- 既存 vector の 20% を超える削除は、`--allow-large-delete` の明示なしでは停止する。
- 内容ハッシュ付き ID は差分と削除対象の識別に使う。同期時は既存 ID も含めて全件を再 embedding / upsert し、同じ ID の values / metadata 破損を修復する。
- vector ID は embedding model、dimensions、metric、chunk contract を含む。契約変更時は全 ID が変わり、大量削除 guard が明示確認を要求する。
- upsert mutation の処理完了を確認してから stale ID を削除し、最終 ID 集合が corpus と完全一致するまで検証する。Cloudflare の一時的な 429 / 5xx / network error は上限付き backoff で再試行する。
- raw query、IP、embedding はログへ残さない。

## API の安全境界

- 同一 Origin の `application/json` POST だけを受け付ける。
- body は 2 KiB、query は 2〜160 文字、`topK` と model は server 側で固定する。
- 全体 300 回/分を先に、client 20 回/分を次に固定窓で D1 へ fail-closed に適用する。全体上限到達後は caller UUID ごとの row を作らない。
- client key はブラウザの session UUID を SHA-256 化して使い、接続 IP は rate limit DBへ使わない。期限切れ row は各検索の前に削除する。
- session UUID は利用者が変更できるため、client 制限だけを費用上限とはみなさない。期限切れ row の削除件数にも上限を設ける。全体制限も必ず有効化し、公開後は Workers AI 利用量と 429 を監視する。必要になった場合は Turnstile や Cloudflare の edge rate-limit を追加する。
- browser が検索を中止した場合は `request.signal` を Workers AI へ伝播し、Vectorize query の前にも中止状態を確認する。
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
