import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	PRODUCTION_SYNC_ATTEMPT_ARTIFACT,
	PRODUCTION_SYNC_SUCCESS_ARTIFACT,
	PRODUCTION_VECTORIZE_INDEX,
	createProductionSyncState,
	parseProductionSyncState,
	productionSyncStateMatches,
	selectLatestTrustedProductionSyncEvent,
	verifyLatestProductionSyncSuccess,
} from '../scripts/production-sync-state.mjs';

const REPOSITORY_ID = '101';
const SITE_A = 'a'.repeat(40);
const SITE_B = 'b'.repeat(40);
const CONTENT_A = 'c'.repeat(40);
const CONTENT_B = 'd'.repeat(40);
const VERSION_A = '1'.repeat(20);
const VERSION_B = '2'.repeat(20);
const DIGEST_A = '3'.repeat(64);
const DIGEST_B = '4'.repeat(64);

test('Production sync receiptはindexとcorpus identityを固定する', () => {
	const receipt = createProductionSyncState({
		state: 'success',
		siteCommit: SITE_A.toUpperCase(),
		contentCommit: CONTENT_A.toUpperCase(),
		corpusVersion: VERSION_A.toUpperCase(),
		corpusSha256: DIGEST_A.toUpperCase(),
		vectorCount: 135,
		workflowRunId: '500',
		workflowRunAttempt: 1,
		attemptArtifactId: '700',
	});

	assert.deepEqual(parseProductionSyncState(JSON.stringify(receipt)), receipt);
	assert.equal(
		receipt.indexName,
		'world-foundation-search-bge-m3-1024-production-v1',
	);
	assert.equal(receipt.indexName, PRODUCTION_VECTORIZE_INDEX);
	assert.equal(
		productionSyncStateMatches(receipt, {
			siteCommit: SITE_A,
			contentCommit: CONTENT_A,
			corpusVersion: VERSION_A,
			corpusSha256: DIGEST_A,
		}),
		true,
	);
	assert.equal(
		productionSyncStateMatches(receipt, {
			siteCommit: SITE_B,
			contentCommit: CONTENT_A,
			corpusVersion: VERSION_A,
		}),
		false,
	);
});

test('最新attemptの後に完了した同じrunのsuccessだけをskip根拠にする', () => {
	const attempt = artifact({
		id: 700,
		name: PRODUCTION_SYNC_ATTEMPT_ARTIFACT,
		runId: 500,
		createdAt: '2026-07-30T01:00:00Z',
	});
	const success = artifact({
		id: 701,
		name: PRODUCTION_SYNC_SUCCESS_ARTIFACT,
		runId: 500,
		createdAt: '2026-07-30T01:01:00Z',
	});
	const receipt = receiptText({
		siteCommit: SITE_A,
		contentCommit: CONTENT_A,
		corpusVersion: VERSION_A,
		corpusSha256: DIGEST_A,
		runId: 500,
		attemptArtifactId: 700,
	});

	assert.equal(
		verifyLatestProductionSyncSuccess({
			attemptArtifacts: { artifacts: [attempt] },
			successArtifacts: { artifacts: [success] },
			repositoryId: REPOSITORY_ID,
			receiptText: receipt,
			workflowRun: workflowRun({ id: 500 }),
			expected: {
				siteCommit: SITE_A,
				contentCommit: CONTENT_A,
				corpusVersion: VERSION_A,
				corpusSha256: DIGEST_A,
			},
		}),
		true,
	);

	const rerun = workflowRun({ id: 500 });
	rerun.run_attempt = 2;
	assert.equal(
		verifyLatestProductionSyncSuccess({
			attemptArtifacts: { artifacts: [attempt] },
			successArtifacts: { artifacts: [success] },
			repositoryId: REPOSITORY_ID,
			receiptText: receipt,
			workflowRun: rerun,
			expected: {
				siteCommit: SITE_A,
				contentCommit: CONTENT_A,
				corpusVersion: VERSION_A,
			},
		}),
		false,
	);

	const untrustedWorkflow = workflowRun({ id: 500 });
	untrustedWorkflow.path = '.github/workflows/untrusted.yml';
	assert.equal(
		verifyLatestProductionSyncSuccess({
			attemptArtifacts: { artifacts: [attempt] },
			successArtifacts: { artifacts: [success] },
			repositoryId: REPOSITORY_ID,
			receiptText: receipt,
			workflowRun: untrustedWorkflow,
			expected: {
				siteCommit: SITE_A,
				contentCommit: CONTENT_A,
				corpusVersion: VERSION_A,
			},
		}),
		false,
	);
});

test('A→B→A rollbackで古いA receiptへfallbackしない', () => {
	const attempts = {
		artifacts: [
			artifact({
				id: 700,
				name: PRODUCTION_SYNC_ATTEMPT_ARTIFACT,
				runId: 500,
				createdAt: '2026-07-30T01:00:00Z',
			}),
			artifact({
				id: 800,
				name: PRODUCTION_SYNC_ATTEMPT_ARTIFACT,
				runId: 600,
				createdAt: '2026-07-30T02:00:00Z',
			}),
		],
	};
	const successes = {
		artifacts: [
			artifact({
				id: 701,
				name: PRODUCTION_SYNC_SUCCESS_ARTIFACT,
				runId: 500,
				createdAt: '2026-07-30T01:01:00Z',
			}),
			artifact({
				id: 801,
				name: PRODUCTION_SYNC_SUCCESS_ARTIFACT,
				runId: 600,
				createdAt: '2026-07-30T02:01:00Z',
			}),
		],
	};
	const latestReceipt = receiptText({
		siteCommit: SITE_B,
		contentCommit: CONTENT_B,
		corpusVersion: VERSION_B,
		corpusSha256: DIGEST_B,
		runId: 600,
		attemptArtifactId: 800,
	});

	assert.equal(
		verifyLatestProductionSyncSuccess({
			attemptArtifacts: attempts,
			successArtifacts: successes,
			repositoryId: REPOSITORY_ID,
			receiptText: latestReceipt,
			workflowRun: workflowRun({ id: 600 }),
			expected: {
				siteCommit: SITE_A,
				contentCommit: CONTENT_A,
				corpusVersion: VERSION_A,
			},
		}),
		false,
	);
});

test('新しいmutation attemptが未完了なら以前のsuccessを採用しない', () => {
	const attempts = {
		artifacts: [
			artifact({
				id: 700,
				name: PRODUCTION_SYNC_ATTEMPT_ARTIFACT,
				runId: 500,
				createdAt: '2026-07-30T01:00:00Z',
			}),
			artifact({
				id: 800,
				name: PRODUCTION_SYNC_ATTEMPT_ARTIFACT,
				runId: 600,
				createdAt: '2026-07-30T02:00:00Z',
			}),
		],
	};
	const successes = {
		artifacts: [
			artifact({
				id: 701,
				name: PRODUCTION_SYNC_SUCCESS_ARTIFACT,
				runId: 500,
				createdAt: '2026-07-30T01:01:00Z',
			}),
		],
	};

	assert.deepEqual(
		selectLatestTrustedProductionSyncEvent(
			{
				attemptArtifacts: attempts,
				successArtifacts: successes,
			},
			{ repositoryId: REPOSITORY_ID },
		),
		{
			status: 'candidate',
			id: '800',
			name: PRODUCTION_SYNC_ATTEMPT_ARTIFACT,
			state: 'attempt',
			expired: false,
			createdAt: '2026-07-30T02:00:00Z',
			workflowRunId: '600',
			repositoryId: REPOSITORY_ID,
			headRepositoryId: REPOSITORY_ID,
			headBranch: 'main',
		},
	);
});

test('最新successがexpiredまたは失敗runなら古い一致へfallbackしない', () => {
	const attempts = {
		artifacts: [
			artifact({
				id: 700,
				name: PRODUCTION_SYNC_ATTEMPT_ARTIFACT,
				runId: 500,
				createdAt: '2026-07-30T01:00:00Z',
			}),
			artifact({
				id: 800,
				name: PRODUCTION_SYNC_ATTEMPT_ARTIFACT,
				runId: 600,
				createdAt: '2026-07-30T02:00:00Z',
			}),
		],
	};
	const successes = {
		artifacts: [
			artifact({
				id: 701,
				name: PRODUCTION_SYNC_SUCCESS_ARTIFACT,
				runId: 500,
				createdAt: '2026-07-30T01:01:00Z',
			}),
			artifact({
				id: 801,
				name: PRODUCTION_SYNC_SUCCESS_ARTIFACT,
				runId: 600,
				createdAt: '2026-07-30T02:01:00Z',
				expired: true,
			}),
		],
	};
	const latestReceipt = receiptText({
		siteCommit: SITE_A,
		contentCommit: CONTENT_A,
		corpusVersion: VERSION_A,
		corpusSha256: DIGEST_A,
		runId: 600,
		attemptArtifactId: 800,
	});

	assert.equal(
		verifyLatestProductionSyncSuccess({
			attemptArtifacts: attempts,
			successArtifacts: successes,
			repositoryId: REPOSITORY_ID,
			receiptText: latestReceipt,
			workflowRun: workflowRun({ id: 600 }),
			expected: {
				siteCommit: SITE_A,
				contentCommit: CONTENT_A,
				corpusVersion: VERSION_A,
			},
		}),
		false,
	);

	successes.artifacts[1].expired = false;
	const failedRun = workflowRun({ id: 600 });
	failedRun.conclusion = 'failure';
	assert.equal(
		verifyLatestProductionSyncSuccess({
			attemptArtifacts: attempts,
			successArtifacts: successes,
			repositoryId: REPOSITORY_ID,
			receiptText: latestReceipt,
			workflowRun: failedRun,
			expected: {
				siteCommit: SITE_A,
				contentCommit: CONTENT_A,
				corpusVersion: VERSION_A,
			},
		}),
		false,
	);
});

test('最新eventの時刻が曖昧ならskipしない', () => {
	const createdAt = '2026-07-30T01:00:00Z';
	const selection = selectLatestTrustedProductionSyncEvent(
		{
			attemptArtifacts: {
				artifacts: [
					artifact({
						id: 700,
						name: PRODUCTION_SYNC_ATTEMPT_ARTIFACT,
						runId: 500,
						createdAt,
					}),
				],
			},
			successArtifacts: {
				artifacts: [
					artifact({
						id: 701,
						name: PRODUCTION_SYNC_SUCCESS_ARTIFACT,
						runId: 500,
						createdAt,
					}),
				],
			},
		},
		{ repositoryId: REPOSITORY_ID },
	);

	assert.deepEqual(selection, { status: 'ambiguous' });
});

function artifact({ id, name, runId, createdAt, expired = false }) {
	return {
		id,
		name,
		expired,
		created_at: createdAt,
		workflow_run: {
			id: runId,
			repository_id: Number(REPOSITORY_ID),
			head_repository_id: Number(REPOSITORY_ID),
			head_branch: 'main',
		},
	};
}

function workflowRun({ id }) {
	return {
		id,
		run_attempt: 1,
		repository: { id: Number(REPOSITORY_ID) },
		head_repository: { id: Number(REPOSITORY_ID) },
		head_branch: 'main',
		status: 'completed',
		conclusion: 'success',
		path: '.github/workflows/sync-vectorize.yml',
		event: 'push',
	};
}

function receiptText({
	siteCommit,
	contentCommit,
	corpusVersion,
	corpusSha256,
	runId,
	attemptArtifactId,
}) {
	return JSON.stringify(
		createProductionSyncState({
			state: 'success',
			siteCommit,
			contentCommit,
			corpusVersion,
			corpusSha256,
			vectorCount: 135,
			workflowRunId: runId,
			workflowRunAttempt: 1,
			attemptArtifactId,
		}),
	);
}
