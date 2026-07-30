import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const workflowUrl = new URL(
	'../.github/workflows/sync-vectorize.yml',
	import.meta.url,
);

test('初期リリースはpreview pushだけを自動同期し、Productionはmainの手動dispatchに限定する', async () => {
	const workflow = await readFile(workflowUrl, 'utf8');
	const triggers = workflow.slice(
		workflow.indexOf('on:'),
		workflow.indexOf('\npermissions:'),
	);
	const productionJob = workflow.slice(
		workflow.indexOf('  build-production-corpus:'),
		workflow.indexOf('\n    runs-on:', workflow.indexOf('  build-production-corpus:')),
	);

	assert.doesNotMatch(triggers, /^\s{2}schedule:/mu);
	assert.match(triggers, /^\s{2}push:\s*\n\s{4}branches:\s*\n\s{6}- preview$/mu);
	assert.match(
		triggers,
		/^\s{2}pull_request:\s*\n\s{4}types:\s*\n(?:\s{6}- .+\n)*\s{6}- edited$/mu,
	);
	assert.match(productionJob, /github\.event_name == 'workflow_dispatch'/u);
	assert.match(productionJob, /github\.ref == 'refs\/heads\/main'/u);
	assert.match(productionJob, /inputs\.target == 'production'/u);
	assert.doesNotMatch(productionJob, /event_name == '(?:push|schedule)'/u);
	assert.match(
		workflow,
		/github\.event_name == 'workflow_dispatch' &&\s+github\.ref == 'refs\/heads\/preview' &&\s+inputs\.target == 'preview'/u,
	);
});

test('Preview同期はbuild時とmutationの前後に保護branch identityを再確認する', async () => {
	const workflow = await readFile(workflowUrl, 'utf8');
	const previewJobs = workflow.slice(
		workflow.indexOf('  build-preview-corpus:'),
		workflow.indexOf('\n  build-production-corpus:'),
	);

	assert.match(
		previewJobs,
		/Preview sync only accepts the current protected source branch commit\./u,
	);
	assert.match(
		previewJobs,
		/Preview sync only accepts the current content main commit\./u,
	);
	assert.match(
		previewJobs,
		/Protected preview source changed during the sync run\./u,
	);
	assert.match(
		previewJobs,
		/Content main changed during the sync run\./u,
	);
	assert.match(
		previewJobs,
		/group: world-foundation-vectorize-preview\s+cancel-in-progress: true/u,
	);
	assert.equal(
		previewJobs.match(/^\s{10}verify_current_identities$/gmu)?.length,
		2,
	);
});

test('main向けPRは同じrepositoryのpreview branchと同一SHAのPreview証跡を要求する', async () => {
	const workflow = await readFile(workflowUrl, 'utf8');
	const pullRequestJob = workflow.slice(
		workflow.indexOf('  verify-pull-request:'),
		workflow.indexOf('\n  build-preview-corpus:'),
	);

	assert.match(
		pullRequestJob,
		/Require protected preview as the source of main promotions/u,
	);
	assert.match(pullRequestJob, /\[\[ "\$HEAD_REF" != "preview" \]\]/u);
	assert.match(
		pullRequestJob,
		/\[\[ "\$HEAD_REPOSITORY" != "\$EXPECTED_HEAD_REPOSITORY" \]\]/u,
	);
	assert.match(
		pullRequestJob,
		/actions\/runs\?branch=preview&head_sha=\$HEAD_SHA&status=completed/u,
	);
	assert.match(pullRequestJob, /run\.conclusion === 'success'/u);
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
