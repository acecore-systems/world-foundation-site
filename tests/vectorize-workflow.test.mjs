import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const workflowUrl = new URL(
	'../.github/workflows/sync-vectorize.yml',
	import.meta.url,
);
const reconcileWorkflowUrl = new URL(
	'../.github/workflows/reconcile-vectorize.yml',
	import.meta.url,
);
const wranglerConfigUrl = new URL('../wrangler.jsonc', import.meta.url);

function parseTrailingCommaJson(text) {
	// The tracked Wrangler config uses JSONC trailing commas without comments.
	return JSON.parse(text.replace(/,\s*([}\]])/gu, '$1'));
}

test('coreはmain/preview pushとPages checkを受け、scheduleを薄いwrapperへ分離する', async () => {
	const workflow = await readFile(workflowUrl, 'utf8');
	const reconcileWorkflow = await readFile(reconcileWorkflowUrl, 'utf8');
	const triggers = workflow.slice(
		workflow.indexOf('on:'),
		workflow.indexOf('\npermissions:'),
	);

	assert.doesNotMatch(triggers, /^\s{2}schedule:/mu);
	assert.match(
		triggers,
		/^\s{2}push:\s*\n\s{4}branches:\s*\n\s{6}- main\s*\n\s{6}- preview\s*\n\s{4}paths-ignore:\s*\n\s{6}- \.github\/workflows\/sync-vectorize\.yml\s*\n\s{6}- tests\/vectorize-workflow\.test\.mjs$/mu,
	);
	assert.match(
		triggers,
		/^\s{2}check_run:\s*\n\s{4}types:\s*\n\s{6}- completed$/mu,
	);
	assert.match(triggers, /^\s{2}workflow_call:/mu);
	assert.match(
		triggers,
		/^\s{2}pull_request:\s*\n\s{4}types:\s*\n(?:\s{6}- .+\n)*\s{6}- edited$/mu,
	);
	assert.match(
		reconcileWorkflow,
		/cron: '7,22,37,52 \* \* \* \*'/u,
	);
	assert.match(
		reconcileWorkflow,
		/uses: \.\/\.github\/workflows\/sync-vectorize\.yml/u,
	);
	assert.match(reconcileWorkflow, /production_reconcile: true/u);
	assert.match(
		workflow,
		/github\.event_name == 'push' &&\s+github\.ref == 'refs\/heads\/preview'/u,
	);
	assert.doesNotMatch(triggers, /target:/u);
});

test('Production候補はexact Pages deploymentを待ち、成功checkを厳格検証する', async () => {
	const workflow = await readFile(workflowUrl, 'utf8');
	const productionJobs = workflow.slice(
		workflow.indexOf('  resolve-production-deployment:'),
	);

	assert.match(
		productionJobs,
		/github\.event_name == 'push' &&\s+github\.ref == 'refs\/heads\/main'/u,
	);
	assert.match(
		productionJobs,
		/github\.event\.check_run\.app\.id == 85455/u,
	);
	assert.match(
		productionJobs,
		/github\.event\.check_run\.app\.slug == 'cloudflare-workers-and-pages'/u,
	);
	assert.match(
		productionJobs,
		/github\.event\.check_run\.name == 'Cloudflare Pages'/u,
	);
	assert.match(
		productionJobs,
		/github\.event\.check_run\.conclusion == 'success'/u,
	);
	assert.match(
		productionJobs,
		/github\.event\.check_run\.head_sha == github\.sha/u,
	);
	assert.match(
		productionJobs,
		/github\.event_name == 'workflow_dispatch' &&\s+github\.ref == 'refs\/heads\/main'/u,
	);
	assert.match(
		productionJobs,
		/Detect the one-time workflow bootstrap/u,
	);
	assert.match(
		productionJobs,
		/\[\[ "\$\{commit_line\[1\]\}" == "\$BOOTSTRAP_BASE_SHA" \]\]/u,
	);
	assert.match(
		productionJobs,
		/steps\.bootstrap\.outputs\.skip != 'true'/u,
	);
	assert.match(
		productionJobs,
		/The one-time workflow bootstrap does not mutate Production state\./u,
	);
	assert.match(
		productionJobs,
		/github\.event_name == 'check_run' && github\.event\.check_run\.head_sha/u,
	);
	assert.match(
		productionJobs,
		/resolve-cloudflare-pages-check\.mjs/u,
	);
	assert.match(
		productionJobs,
		/git -C verifier merge-base --is-ancestor\s+\\\s+"\$EXPECTED_SITE_COMMIT" refs\/remotes\/origin\/main/u,
	);
	assert.match(
		productionJobs,
		/"\$deployment_marker_url"\s+\\\s+"\$EXPECTED_SITE_COMMIT"/u,
	);
	assert.match(
		productionJobs,
		/--wait-for-current\s+\\\s+"\$RUNNER_TEMP\/cloudflare-deployment-marker\.json"/u,
	);
});

test('Production mutationを直列化し、attempt/success stateで重複と失敗を判別する', async () => {
	const workflow = await readFile(workflowUrl, 'utf8');
	const productionJobs = workflow.slice(
		workflow.indexOf('  resolve-production-deployment:'),
	);

	assert.match(
		productionJobs,
		/group: world-foundation-vectorize-production\s+cancel-in-progress: false/u,
	);
	assert.match(
		productionJobs,
		/world-foundation-vectorize-production-build-\$\{\{/u,
	);
	assert.match(
		productionJobs,
		/needs\.resolve-production-deployment\.outputs\.site_commit[\s\S]*?needs\.resolve-production-deployment\.outputs\.content_commit[\s\S]*?needs\.resolve-production-deployment\.outputs\.corpus_version/u,
	);
	assert.match(
		productionJobs,
		/cancel-in-progress: \$\{\{ github\.event_name != 'workflow_dispatch' \}\}/u,
	);
	assert.match(
		productionJobs,
		/select-latest-success/u,
	);
	assert.match(
		productionJobs,
		/name: Check out protected-main Production tooling[\s\S]*?ref: \$\{\{ github\.sha \}\}/u,
	);
	assert.match(
		productionJobs,
		/if \[\[ "\$FORCE_SYNC" == "true" \]\]; then\s+echo "should_sync=true"/u,
	);
	assert.equal(
		productionJobs.match(/retention-days: 90/g)?.length,
		2,
	);
	assert.equal(
		productionJobs.match(/overwrite: true/g)?.length,
		2,
	);
	assert.equal(
		productionJobs.match(
			/GitHub could not provide the Production sync state\./g,
		)?.length,
		2,
	);

	const recheck = productionJobs.indexOf(
		'Recheck the latest Production sync state after concurrency wait',
	);
	const attempt = productionJobs.indexOf(
		'Publish the Production sync attempt state',
	);
	const mutation = productionJobs.indexOf('Sync the production index');
	const finalAssert = productionJobs.lastIndexOf('--assert-current');
	const success = productionJobs.indexOf(
		'Publish the successful Production sync state',
	);
	const token = productionJobs.indexOf(
		'CLOUDFLARE_SEARCH_PRODUCTION_API_TOKEN',
	);
	const openAiKey = productionJobs.indexOf(
		'OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}',
	);

	assert.ok(recheck >= 0 && recheck < attempt);
	assert.ok(attempt < mutation);
	assert.ok(recheck < token);
	assert.ok(recheck < openAiKey);
	assert.ok(mutation < finalAssert);
	assert.ok(finalAssert < success);
});

test('PreviewはVectorizeを使わずbuild/deploymentと保護branch identityだけを検証する', async () => {
	const workflow = await readFile(workflowUrl, 'utf8');
	const previewJobs = workflow.slice(
		workflow.indexOf('  build-preview-corpus:'),
		workflow.indexOf('\n  resolve-production-deployment:'),
	);

	assert.match(
		previewJobs,
		/Preview corpus verification only accepts the current protected source branch commit\./u,
	);
	assert.match(
		previewJobs,
		/Preview corpus verification only accepts the current content main commit\./u,
	);
	assert.match(
		previewJobs,
		/Protected preview source changed during verification\./u,
	);
	assert.match(
		previewJobs,
		/Content main changed during Preview verification\./u,
	);
	assert.match(
		previewJobs,
		/https:\/\/preview\.world-foundation-site\.pages\.dev\/\.well-known\/world-foundation-build\.json/u,
	);
	assert.match(previewJobs, /--assert-current\s+\\\s+payload\/corpus\.json/u);
	assert.equal(
		previewJobs.match(/^\s{10}verify_current_identities$/gmu)?.length,
		2,
	);
	assert.doesNotMatch(previewJobs, /environment:/u);
	assert.doesNotMatch(previewJobs, /CLOUDFLARE_API_TOKEN/u);
	assert.doesNotMatch(previewJobs, /OPENAI_API_KEY/u);
	assert.doesNotMatch(previewJobs, /--target preview/u);
	assert.doesNotMatch(previewJobs, /Sync the preview index/u);
});

test('OpenAI keyとCloudflare Vectorize tokenをProduction同期stepだけへ渡す', async () => {
	const workflow = await readFile(workflowUrl, 'utf8');

	assert.equal(
		workflow.match(
			/OPENAI_API_KEY: \$\{\{ secrets\.OPENAI_API_KEY \}\}/gu,
		)?.length,
		1,
	);
	assert.equal(
		workflow.match(
			/CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_SEARCH_PRODUCTION_API_TOKEN \}\}/gu,
		)?.length,
		1,
	);
	assert.doesNotMatch(workflow, /CLOUDFLARE_SEARCH_PREVIEW_API_TOKEN/u);
	assert.doesNotMatch(workflow, /Workers AI Read/u);
});

test('main向けPRはprotected preview、同一treeのresolution、または限定した運用設定変更だけを許可する', async () => {
	const workflow = await readFile(workflowUrl, 'utf8');
	const pullRequestJob = workflow.slice(
		workflow.indexOf('  verify-pull-request:'),
		workflow.indexOf('\n  build-preview-corpus:'),
	);

	assert.match(pullRequestJob, /Verify the main promotion source/u);
	assert.match(
		pullRequestJob,
		/\[\[ "\$HEAD_REPOSITORY" != "\$EXPECTED_HEAD_REPOSITORY" \]\]/u,
	);
	assert.match(
		pullRequestJob,
		/\[\[ "\$BASE_SHA" != "\$current_main_sha" \]\]/u,
	);
	assert.match(
		pullRequestJob,
		/\[\[ "\$HEAD_SHA" != "\$current_preview_sha" \]\]/u,
	);
	assert.match(
		pullRequestJob,
		/\^codex\/preview-promotion-resolution-\(\[0-9a-f\]\{40\}\)\$/u,
	);
	assert.match(
		pullRequestJob,
		/\[\[ "\$head_parent_count" != "1" \]\]/u,
	);
	assert.match(
		pullRequestJob,
		/\[\[ "\$head_parent_sha" != "\$current_main_sha" \]\]/u,
	);
	assert.match(
		pullRequestJob,
		/\[\[ "\$head_tree_sha" != "\$preview_tree_sha" \]\]/u,
	);
	assert.match(
		pullRequestJob,
		/'\.github\/workflows\/sync-vectorize\.yml:modified'/u,
	);
	assert.match(
		pullRequestJob,
		/'tests\/vectorize-workflow\.test\.mjs:modified'/u,
	);
	assert.match(
		pullRequestJob,
		/BOOTSTRAP_HEAD_REF: codex\/world-promotion-workflow-hardening-v2/u,
	);
	assert.match(
		pullRequestJob,
		/OPERATIONAL_BOOTSTRAP_HEAD_REF: codex\/share-production-d1-20260731/u,
	);
	assert.match(
		pullRequestJob,
		/OPERATIONAL_BOOTSTRAP_PARENT_SHA: f4a13ceb5b9cc6c86b1f4986323858cc26249ea8/u,
	);
	assert.match(pullRequestJob, /'docs\/vectorize-search\.md:modified'/u);
	assert.match(pullRequestJob, /'wrangler\.jsonc:modified'/u);
	assert.match(pullRequestJob, /pullRequest\.commits !== 2/u);
	assert.match(pullRequestJob, /mode=operational-bootstrap/u);
	assert.match(pullRequestJob, /const operationalFiles = new Set/u);
	assert.match(pullRequestJob, /pullRequest\.commits === 1/u);
	assert.match(
		pullRequestJob,
		/process\.env\.HEAD_PARENT_SHA === process\.env\.CURRENT_MAIN_SHA/u,
	);
	assert.match(pullRequestJob, /mode=operational/u);
	assert.match(
		pullRequestJob,
		/steps\.promotion\.outputs\.mode == 'preview' \|\| steps\.promotion\.outputs\.mode == 'resolution'/u,
	);
	assert.match(
		pullRequestJob,
		/actions\/runs\?branch=preview&head_sha=\$PREVIEW_SHA&status=completed/u,
	);
	assert.match(pullRequestJob, /run\.event === 'push'/u);
	assert.match(pullRequestJob, /run\.conclusion === 'success'/u);
	assert.match(pullRequestJob, /world-foundation-preview-corpus-\*/u);
	assert.match(pullRequestJob, /run-id: \$\{\{ steps\.preview-evidence\.outputs\.run_id \}\}/u);
	assert.match(
		pullRequestJob,
		/https:\/\/preview\.world-foundation-site\.pages\.dev\/\.well-known\/world-foundation-build\.json/u,
	);
	assert.match(
		pullRequestJob,
		/"\$PREVIEW_BUILD_MARKER_URL"\s+\\\s+"\$EXPECTED_SITE_COMMIT"/u,
	);
	assert.match(
		pullRequestJob,
		/--assert-current\s+\\\s+preview-evidence\/corpus\.json/u,
	);
});

test('PreviewはVectorize bindingなし、収束後はProductionだけ意味検索を有効化する', async () => {
	const config = await readFile(wranglerConfigUrl, 'utf8');
	const parsedConfig = parseTrailingCommaJson(config);

	assert.equal(
		config.match(
			/"index_name": "world-foundation-search-openai-1536-production"/gu,
		)?.length,
		1,
	);
	assert.doesNotMatch(
		config,
		/world-foundation-search-openai-1536-preview/u,
	);
	assert.equal(parsedConfig.vars.SEARCH_ENABLED, 'false');
	assert.equal(parsedConfig.env.preview.vars.SEARCH_ENABLED, 'false');
	assert.equal(parsedConfig.env.production.vars.SEARCH_ENABLED, 'true');
});
