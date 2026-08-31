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

test('coreはmain pushとPages checkを受け、scheduleを薄いwrapperへ分離する', async () => {
	const workflow = await readFile(workflowUrl, 'utf8');
	const reconcileWorkflow = await readFile(reconcileWorkflowUrl, 'utf8');
	const triggers = workflow.slice(
		workflow.indexOf('on:'),
		workflow.indexOf('\npermissions:'),
	);

	assert.doesNotMatch(triggers, /^\s{2}schedule:/mu);
	assert.match(
		triggers,
		/^\s{2}push:\s*\n\s{4}branches:\s*\n\s{6}- main$/mu,
	);
	assert.match(
		triggers,
		/^\s{2}check_run:\s*\n\s{4}types:\s*\n\s{6}- completed$/mu,
	);
	assert.match(triggers, /^\s{2}workflow_call:/mu);
	assert.match(
		triggers,
		/^\s{2}pull_request:\s*\n\s{4}types:\s*\n(?:\s{6}- .+\n)*\s{6}- edited\s*\n\s{4}branches:\s*\n\s{6}- main$/mu,
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
	assert.doesNotMatch(triggers, /preview/iu);
	assert.doesNotMatch(triggers, /paths-ignore:/u);
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
	assert.doesNotMatch(productionJobs, /\bbootstrap\b/iu);
	assert.match(
		productionJobs,
		/Verify deployment verifier belongs to protected main/u,
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

	assert.ok(recheck >= 0 && recheck < attempt);
	assert.ok(attempt < mutation);
	assert.ok(recheck < token);
	assert.ok(mutation < finalAssert);
	assert.ok(finalAssert < success);
});

test('長期preview branch固有jobを持たず、PR検証はsecretを使わない', async () => {
	const workflow = await readFile(workflowUrl, 'utf8');
	const pullRequestJob = workflow.slice(
		workflow.indexOf('  verify-pull-request:'),
		workflow.indexOf('\n  resolve-production-deployment:'),
	);

	assert.doesNotMatch(workflow, /^  build-preview-corpus:/mu);
	assert.doesNotMatch(workflow, /^  verify-preview-deployment:/mu);
	assert.doesNotMatch(workflow, /refs\/heads\/preview/u);
	assert.doesNotMatch(workflow, /protected preview/iu);
	assert.doesNotMatch(pullRequestJob, /environment:/u);
	assert.doesNotMatch(pullRequestJob, /CLOUDFLARE_API_TOKEN/u);
	assert.doesNotMatch(pullRequestJob, /OPENAI_API_KEY/u);
});

test('Workers AIとVectorize用Cloudflare tokenをProduction同期stepだけへ渡す', async () => {
	const workflow = await readFile(workflowUrl, 'utf8');

	assert.doesNotMatch(workflow, /OPENAI_API_KEY/u);
	assert.equal(
		workflow.match(
			/CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_SEARCH_PRODUCTION_API_TOKEN \}\}/gu,
		)?.length,
		1,
	);
	assert.doesNotMatch(workflow, /CLOUDFLARE_SEARCH_PREVIEW_API_TOKEN/u);
});

test('main向けPRは最新main由来の同一repository branchだけを許可する', async () => {
	const workflow = await readFile(workflowUrl, 'utf8');
	const pullRequestJob = workflow.slice(
		workflow.indexOf('  verify-pull-request:'),
		workflow.indexOf('\n  resolve-production-deployment:'),
	);

	assert.match(pullRequestJob, /Verify the direct main pull request source/u);
	assert.match(
		pullRequestJob,
		/\[\[ "\$HEAD_REPOSITORY" != "\$EXPECTED_HEAD_REPOSITORY" \]\]/u,
	);
	assert.match(
		pullRequestJob,
		/\[\[ "\$BASE_SHA" != "\$current_main_sha" \]\]/u,
	);
	assert.match(pullRequestJob, /compare\/\$current_main_sha\.\.\.\$HEAD_SHA/u);
	assert.match(pullRequestJob, /comparison\.status \|\| '-'/u);
	assert.match(pullRequestJob, /comparison\.ahead_by \?\? -1/u);
	assert.match(
		pullRequestJob,
		/comparison\.merge_base_commit\?\.sha \|\| '-'/u,
	);
	assert.match(pullRequestJob, /\[\[ "\$comparison_status" != "ahead" \]\]/u);
	assert.match(
		pullRequestJob,
		/\[\[ "\$comparison_merge_base_sha" != "\$current_main_sha" \]\]/u,
	);
	assert.match(pullRequestJob, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/u);
	assert.match(pullRequestJob, /--target production/u);
	assert.doesNotMatch(pullRequestJob, /bootstrap/iu);
	assert.doesNotMatch(pullRequestJob, /preview/iu);
	assert.doesNotMatch(pullRequestJob, /promotion/iu);
});

test('PreviewはVectorize bindingなし、収束後はProductionだけ意味検索を有効化する', async () => {
	const config = await readFile(wranglerConfigUrl, 'utf8');
	const parsedConfig = parseTrailingCommaJson(config);

	assert.equal(
		config.match(
			/"index_name": "world-foundation-search-bge-m3-1024-production-v1"/gu,
		)?.length,
		1,
	);
	assert.doesNotMatch(
		config,
		/world-foundation-search-bge-m3-1024-preview/u,
	);
	assert.equal(parsedConfig.vars.SEARCH_ENABLED, 'false');
	assert.equal(parsedConfig.env.preview.vars.SEARCH_ENABLED, 'false');
	assert.equal(parsedConfig.env.production.vars.SEARCH_ENABLED, 'true');
});
