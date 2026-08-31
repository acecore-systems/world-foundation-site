# Vectorize検索運用

World Foundation Site の検索は、次の 2 系統を同じ検索モーダルで提供します。

- Pagefind: ブラウザ内で動くキーワード検索。常に主検索として残す。
- Cloudflare Vectorize: Workers AI のBGE-M3多言語embeddingを使う「関連する内容」。失敗時はこの欄だけを隠し、Pagefind を継続する。

Vectorize を AI 回答生成には使いません。公開済み設計資料の候補を返す検索補助として扱います。

## 構成

1. `scripts/sync-content.mjs` が原典を同期し、公開 route と原典 commit を `.vectorize/content-manifest.json` に記録する。
2. Astro と Starlight が静的サイトと Pagefind index を `dist/` に生成する。
3. `scripts/build-search-corpus.mjs` が公開 HTML から本文を抽出し、`.vectorize/corpus.json` を生成する。
4. `scripts/sync-vectorize.mjs` が全 chunk をCloudflare Workers AIへ送って再 embedding し、Vectorize へ upsert して同じ ID の values / metadata 破損も修復する。
5. corpus から消えた ID を削除し、最後の mutation が検索可能になるまで待つ。
6. Pages Function `/api/search` がネイティブ `AI` bindingの同じmodelでqueryをembeddingし、binding経由で表示中の言語namespaceを検索する。

公開書き込み API はありません。index 更新は protected `main` 上のProduction
GitHub Actionsからのみ実行します。同じrepositoryのfeature branchから`main`への
Pull Requestは、exact headと現在の原典からbuild、test、同期dry-runをsecretなしで
検証します。Pages PreviewにはVectorize index、binding、GitHub Environment、
同期用token/secretを置かず、Vectorizeへ接続・同期しません。

## Cloudflare リソース

| 環境       | Vectorize index                                     | D1 rate-limit database               | semantic search |
| ---------- | --------------------------------------------------- | ------------------------------------ | --------------- |
| Preview    | なし（index / bindingなし）                         | `world-foundation-search-production` | 無効            |
| Production | `world-foundation-search-bge-m3-1024-production-v1` | `world-foundation-search-production` | 有効            |

embedding contract は次のとおりです。

- model: `@cf/baai/bge-m3`
- dimensions: `1024`
- pooling: `cls`
- metric: `cosine`
- chunk: 850 文字目標 / 1200 文字上限 / 120 文字 overlap

queryとcorpusの両方を同じBGE-M3 / 1024次元 / cosine契約で生成します。model、dimensions、metricは既存index内で混在させません。旧OpenAI / 1536次元のProduction indexは即時rollback用に保持し、この移行では削除しません。

Pages 設定は `wrangler.jsonc` を source of truth とします。導入前の Dashboard 設定は `wrangler pages download config world-foundation-site` で取得し、project 名、output directory、compatibility date、空の production environment だけであることを確認済みです。

Pages FunctionはProductionだけに置いたネイティブ `AI` bindingを使用します。`wrangler.jsonc` の `vars` にはmodelとdimensionsを置き、検索embedding用の外部API keyは持ちません。同期workflowはProduction GitHub EnvironmentのCloudflare tokenでWorkers AI REST APIとVectorizeを呼びます。PreviewにはVectorize/AI binding、同期用GitHub Environment、Cloudflare tokenを置かず、Pull Request検証にもsecretを渡しません。

Preview向けindexは置きません。PreviewはVectorize index、
binding、同期経路を持たず、Pagefindだけを検証します。Production indexはGitHub Actions run
[30602663665](https://github.com/acecore-systems/world-foundation-site/actions/runs/30602663665)
で公開buildと一致する135 vectorsへ同期した記録は旧OpenAI indexの証跡です。新BGE-M3 indexの完了判定には使いません。rootとPreviewは
`SEARCH_ENABLED="false"`、Productionだけを`"true"`にします。

## 原典と公開 build の一致

World Foundation は site repo と原典 repo が分かれています。公開 marker
`/.well-known/world-foundation-build.json` には次を記録します。

- `siteCommit`: `world-foundation-site` の commit
- `contentCommit`: `world-foundation` の commit
- `searchCorpusVersion`: chunk ID 集合から作る corpus version

production 同期は、公開 marker が示す両 commit を checkout して corpus を再生成し、同期直前にも公開 marker と 3 値が一致する場合だけ実行します。site の push 後に Pages deployment が失敗した場合や、build 中に原典の公開状態が変わった場合は index を更新しません。

`main` push では、custom domain の marker がその exact site SHA へ切り替わるまで待ちます。原典だけが更新された場合は、既存の Pages Deploy Hook がサイトを再構築します。Cloudflare Pages の成功 check から immutable な deployment URL を検証して新しい 3 値を取得し、custom domain に同じ 3 値が現れてから自動同期します。同じ site SHA のまま content commit だけが変わる場合も、旧 marker を即採用しません。

## GitHub Actions と secret

`.github/workflows/sync-vectorize.yml` は次を提供します。

- feature branchから`main`へのPull Request: exact headと現在の原典を使い、secretなしでbuild、検索テスト、型検査、Pages Functions bundle、同期dry-runを検証。
- `main` push: exact site SHA の公開完了後、現在公開中の組み合わせを production index へ自動同期。
- Cloudflare Pages Production check: GitHubがexternal appの`check_run`を配信した場合、Deploy Hookを含む immutable deployment と custom domain の 3 値一致後に自動同期。
- `.github/workflows/reconcile-vectorize.yml`: 毎時 7、22、37、52 分に公開中の組み合わせを再照合。
- 手動 `production`: 同期済み判定を無視し、現在公開中の組み合わせを production index へ強制再同期・修復。

site変更は、最新のprotected `main` をmerge baseに持つ同一repositoryのfeature branchから
`main`へ直接Pull Requestを作ります。必須checkとCloudflare Pages Previewで検証し、merge後の
`main` pushでProduction公開とVectorize同期を行います。長期release branchや二段階昇格は
設けません。

原典 repository の `main` 更新だけでは site repository の Pull Request check は再実行されません。公開後の Production 同期は、Deploy Hook が作る Cloudflare Pages check と15分ごとの再照合が補完します。GitHubは再帰防止のため、head SHAがGitHub Actionsに関連付くcheck eventを抑止する場合があります。Pages checkのeventが届かない場合や形式を検証できない場合も、定期再照合が公開markerを検出します。marker不一致runではmutationせず、次の定期再照合または手動 Production dispatchへ倒します。

自動runは、Production mutationの直前に固定名の `attempt` artifactを発行し、全件upsert・削除・最終ID検証と公開markerの再確認が終わった後だけ `success` artifactを発行します。省略判定に使うのは履歴中の一致ではなく、信頼できる `main` workflowが残した最新eventだけです。最新が未完了のattempt、期限切れ、破損、不一致なら安全側で同期します。GitHub APIからstateを取得できない場合はmutationせずrunを失敗させ、次の定期再照合を待ちます。このため A→B→A のrollbackや途中失敗で古いAの成功履歴を誤採用しません。artifactは90日保持し、期限切れ後は一度修復同期して状態を更新します。この判定はProduction tokenをこのworkflowだけが使う単一writerを前提とします。artifactを選択削除した場合や外部からindexを直接変更した場合は、手動Production dispatchで強制修復します。

実 corpus を作る job と token を使うProduction同期 job は runner を分けます。
同期 job はprotected `main`の依存なしスクリプトを再checkoutし、artifactの
site/content/corpus 3値を検証してから、最後のstepだけへtokenを渡します。

Production mutation jobは `world-foundation-vectorize-production` concurrencyで直列化し、開始後はcancelしません。concurrency待ちの後にも最新successを再照合するため、同じdeploymentを見たpush、Pages check、定期runのうち後続runは再embeddingを省略します。GitHub concurrencyが複数のpending runをまとめた場合も、次の定期runが現在の公開markerへ収束させます。手動 Production dispatchだけはこの省略を行わず、同じIDのvalues / metadata破損も含めて全件を修復します。

定期再照合はpublic repositoryの無活動60日でGitHubに自動停止される可能性があるため、push・Pages check・手動dispatchを持つcore workflowとは別ファイルにしています。停止しても主経路は巻き込まれません。状態確認と復旧は次で行います。

```powershell
gh api repos/acecore-systems/world-foundation-site/actions/workflows/reconcile-vectorize.yml --jq .state
gh workflow enable reconcile-vectorize.yml --repo acecore-systems/world-foundation-site
```

Vectorizeは同じindexへin-placeでupsertするため、厳密な原子的切替ではありません。markerがmutation中に変わればrunは失敗し、次の自動runが修復しますが、その間に新旧vectorが短時間混在する可能性は残ります。完全なzero-mixed-stateが必要になった場合は、新indexを構築してbindingを切り替えるblue/green方式へ移行します。

Production同期で参照するGitHub Environmentとenvironment secretは次のとおりです。

| GitHub Environment                              | Cloudflare Environment secret            | 同期先           |
| ----------------------------------------------- | ---------------------------------------- | ---------------- |
| `cloudflare-world-foundation-search-production` | `CLOUDFLARE_SEARCH_PRODUCTION_API_TOKEN` | production index |

Production Environmentは`main`だけに制限します。Cloudflare tokenはAcecore
accountだけをresourceに指定し、同期に必要なWorkers AI ReadとVectorize Read / Writeだけを付与します。
値はrepo、設定、ログ、PR本文へ書きません。secretはbuildへ渡さず、fresh runnerの最終同期stepだけに渡します。
Preview用のGitHub Environment、同期token、Vectorize indexは置きません。
Vectorize同期workflowとPagesの`SEARCH_INDEX` bindingはProduction resourceだけを参照します。

CloudflareのVectorize権限はaccount scopeで個別indexには制限できないため、
Production Environmentだけへ書込みtokenを渡す構成そのものを権限境界にします。

単独運用中の `main` は明示承認により required approval を 0、last-push approval を無効にしています。dismiss stale review は有効のままです。strict な `Verify semantic search changes without secrets` を必須にし、Pull Request、admin への保護適用、linear history、conversation resolution、force push / branch delete 禁止を維持します。必須workflowは`main`向けPRが同じrepositoryから作られ、baseが現在のprotected `main`、headがそのcommitより先行していることも検証します。Cloudflare Pages PreviewはPRごとの表示確認に使いますが、`main`の必須ステータスにはしません。

この単独運用の例外は独立レビューを失う運用リスクです。GitHub はPR作成者自身の正式な `APPROVE` を許可しないため、Codexは最終push後のhead SHAに対するレビュー結果を `COMMENT` として監査記録に残します。ただし、required approval が 0 の間はこのCOMMENTもdismiss stale reviewもマージを止める強制ゲートにはなりません。`main` はProductionの公開元なので、別 reviewer を用意できた時点で1承認とlast-push approvalへ戻します。workflow と `scripts/sync-vectorize.mjs` を CODEOWNERS の対象にする場合は、独立 reviewer の用意と `require_code_owner_reviews` の有効化をセットで行います。

Pages PreviewはVectorize resourceとbindingを持たず、`SEARCH_ENABLED=false`でPagefindだけを
検証します。Cloudflare PagesのPreview branch controlは`custom`とし、`cms/pending/*`を除く
すべてのbranchを許可します。各feature branchは固有URLで確認し、review済みPull Requestを
`main`へ直接mergeします。

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

Preview deploymentではPagefindが動作し、`/api/search`がfail closedすることを
確認します。23件の固定fixtureによる実Vectorize評価は、Production有効化後の
canaryとして実行します。

Pages binding を含むローカル確認では、Previewと共有するProduction名のlocal D1へ先にmigrationを適用します。

```powershell
volta run --node 24.18.0 npx wrangler d1 migrations apply world-foundation-search-production --local
volta run --node 24.18.0 npx wrangler pages dev --env preview
```

Previewには`SEARCH_INDEX`がなく`SEARCH_ENABLED=false`のため、通常のローカル
確認でWorkers AIやVectorizeへ接続しません。

remote D1 migration は共有するProduction databaseへdeploymentより先に明示適用し、未適用がないことを再確認します。

```powershell
volta run --node 24.18.0 npx wrangler d1 migrations apply world-foundation-search-production --remote --env production
volta run --node 24.18.0 npx wrangler d1 migrations list world-foundation-search-production --remote --env production
```

## 同期の安全策

- 同期先index名はWorld FoundationのProduction候補1件だけを許可する。
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
- session UUID は利用者が変更できるため、client 制限だけを費用上限とはみなさない。期限切れ row の削除件数にも上限を設ける。全体制限も必ず有効化し、公開後は Workers AI の利用量と 429 を監視する。必要になった場合は Turnstile や Cloudflare の edge rate-limit を追加する。
- browser が検索を中止した場合はWorkers AI実行の前後とVectorize queryの前に中止状態を確認する。
- metadata の URL は同一 Origin の root-relative 公開 route だけを許可する。
- response は `Cache-Control: no-store`。runtime log は request ID、stage、error class だけを記録する。
- `SEARCH_ENABLED` を `"false"` にすると、UI と Pagefind を壊さず意味検索 API を停止できる。

## 障害対応

1. Pagefind のキーワード検索が動くことを確認する。
2. `/api/search` の status と `X-Search-Request-Id` を確認する。
3. Pages Functions の runtime log を request ID で追う。query 本文は記録されない。
4. Workers AI、Vectorize、D1 の障害時は `SEARCH_ENABLED` を `"false"` にして再 deploy する。
5. index を作り直す場合は新 index の同期と canary を終えてから binding を切り替える。切替前に現在のProduction indexを削除しない。

## BGE-M3 / 1024次元移行 gate

新しいBGE-M3 / 1024次元Production indexは、GitHub-connected Production deployment前に全件同期し、
ID集合、corpus version、日英namespace canaryを確認します。直前のOpenAI / 1536次元indexはrollback用に残します。PreviewはVectorize resource / bindingなし・
`SEARCH_ENABLED=false`を維持し、Productionだけを有効化します。canaryに失敗した場合は
`SEARCH_ENABLED=false`へ戻してPagefindを継続し、必要なら新しい互換indexを構築してbindingを切り替えます。

## 公式資料

- [Vectorize client API](https://developers.cloudflare.com/vectorize/reference/client-api/)
- [Vectorize limits](https://developers.cloudflare.com/vectorize/platform/limits/)
- [Vectorize insert best practices](https://developers.cloudflare.com/vectorize/best-practices/insert-vectors/)
- [Workers AI BGE-M3](https://developers.cloudflare.com/workers-ai/models/bge-m3/)
- [Workers AI REST API](https://developers.cloudflare.com/api/resources/ai/subresources/run/methods/create/)
- [Pages Functions bindings](https://developers.cloudflare.com/pages/functions/bindings/)
- [Pages Wrangler configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)
- [Pages preview aliases and immutable deployment URLs](https://developers.cloudflare.com/pages/configuration/preview-deployments/#preview-aliases)
- [D1](https://developers.cloudflare.com/d1/)
- [GitHub `check_run` event](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#check_run)
- [GitHub scheduled workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [GitHub Actions artifacts API](https://docs.github.com/en/rest/actions/artifacts)
