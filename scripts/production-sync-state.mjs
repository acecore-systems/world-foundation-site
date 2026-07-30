import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRODUCTION_SYNC_ATTEMPT_ARTIFACT =
	'world-foundation-vectorize-production-attempt-v1';
export const PRODUCTION_SYNC_SUCCESS_ARTIFACT =
	'world-foundation-vectorize-production-success-v1';
export const PRODUCTION_VECTORIZE_INDEX =
	'world-foundation-search-production';

const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;
const CORPUS_VERSION_PATTERN = /^[0-9a-f]{20}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;
const TRUSTED_WORKFLOW_PATHS = new Set([
	'.github/workflows/reconcile-vectorize.yml',
	'.github/workflows/sync-vectorize.yml',
]);
const TRUSTED_WORKFLOW_EVENTS = new Set([
	'check_run',
	'push',
	'schedule',
	'workflow_call',
	'workflow_dispatch',
]);

export function createProductionSyncState({
	state,
	siteCommit,
	contentCommit,
	corpusVersion,
	corpusSha256,
	vectorCount,
	workflowRunId,
	workflowRunAttempt,
	attemptArtifactId,
}) {
	if (!['attempt', 'success'].includes(state)) {
		throw new Error('Production sync state must be attempt or success.');
	}

	const normalized = {
		schemaVersion: 1,
		state,
		target: 'production',
		indexName: PRODUCTION_VECTORIZE_INDEX,
		siteCommit: normalizeCommit(siteCommit, 'site'),
		contentCommit: normalizeCommit(contentCommit, 'content'),
		corpusVersion: normalizeCorpusVersion(corpusVersion),
		corpusSha256: normalizeSha256(corpusSha256),
		vectorCount: normalizeVectorCount(vectorCount),
		workflowRunId: normalizePositiveInteger(workflowRunId, 'workflow run ID'),
		workflowRunAttempt: Number(
			normalizePositiveInteger(workflowRunAttempt, 'workflow run attempt'),
		),
	};

	if (state === 'success') {
		normalized.attemptArtifactId = normalizePositiveInteger(
			attemptArtifactId,
			'attempt artifact ID',
		);
	} else if (attemptArtifactId !== undefined) {
		throw new Error('Attempt state must not reference an attempt artifact.');
	}

	return normalized;
}

export function parseProductionSyncState(text) {
	const payload = JSON.parse(text);
	if (
		payload?.schemaVersion !== 1 ||
		payload?.target !== 'production' ||
		payload?.indexName !== PRODUCTION_VECTORIZE_INDEX
	) {
		throw new Error('Production sync state identity is invalid.');
	}

	return createProductionSyncState(payload);
}

export function productionSyncStateMatches(
	state,
	{ siteCommit, contentCommit, corpusVersion, corpusSha256 },
) {
	const expected = {
		siteCommit: normalizeCommit(siteCommit, 'expected site'),
		contentCommit: normalizeCommit(contentCommit, 'expected content'),
		corpusVersion: normalizeCorpusVersion(corpusVersion),
		corpusSha256:
			corpusSha256 === undefined
				? undefined
				: normalizeSha256(corpusSha256),
	};

	return (
		state.state === 'success' &&
		state.siteCommit === expected.siteCommit &&
		state.contentCommit === expected.contentCommit &&
		state.corpusVersion === expected.corpusVersion &&
		(expected.corpusSha256 === undefined ||
			state.corpusSha256 === expected.corpusSha256)
	);
}

export function selectLatestTrustedProductionSyncEvent(
	{ attemptArtifacts, successArtifacts },
	{ repositoryId },
) {
	const normalizedRepositoryId = normalizePositiveInteger(
		repositoryId,
		'repository ID',
	);
	const artifacts = [
		...normalizeArtifactPages(
			attemptArtifacts,
			PRODUCTION_SYNC_ATTEMPT_ARTIFACT,
			'attempt',
		),
		...normalizeArtifactPages(
			successArtifacts,
			PRODUCTION_SYNC_SUCCESS_ARTIFACT,
			'success',
		),
	].filter((artifact) =>
		isTrustedArtifact(artifact, normalizedRepositoryId),
	);

	artifacts.sort(
		(left, right) =>
			Date.parse(right.createdAt) - Date.parse(left.createdAt),
	);
	if (artifacts.length === 0) {
		return { status: 'none' };
	}
	if (
		artifacts.length > 1 &&
		Date.parse(artifacts[0].createdAt) === Date.parse(artifacts[1].createdAt)
	) {
		return { status: 'ambiguous' };
	}

	return {
		status: 'candidate',
		...artifacts[0],
	};
}

export function verifyLatestProductionSyncSuccess({
	attemptArtifacts,
	successArtifacts,
	repositoryId,
	receiptText,
	workflowRun,
	expected,
}) {
	const selection = selectLatestTrustedProductionSyncEvent(
		{ attemptArtifacts, successArtifacts },
		{ repositoryId },
	);
	if (
		selection.status !== 'candidate' ||
		selection.state !== 'success' ||
		selection.expired
	) {
		return false;
	}

	const receipt = parseProductionSyncState(receiptText);
	if (
		receipt.workflowRunId !== selection.workflowRunId ||
		!productionSyncStateMatches(receipt, expected)
	) {
		return false;
	}

	const run = normalizeWorkflowRun(workflowRun);
	if (
		run.id !== selection.workflowRunId ||
		run.attempt !== receipt.workflowRunAttempt ||
		run.repositoryId !== String(repositoryId) ||
		run.headRepositoryId !== String(repositoryId) ||
		run.headBranch !== 'main' ||
		run.status !== 'completed' ||
		run.conclusion !== 'success' ||
		!TRUSTED_WORKFLOW_PATHS.has(run.path) ||
		!TRUSTED_WORKFLOW_EVENTS.has(run.event)
	) {
		return false;
	}

	const trustedAttempts = normalizeArtifactPages(
		attemptArtifacts,
		PRODUCTION_SYNC_ATTEMPT_ARTIFACT,
		'attempt',
	).filter((artifact) =>
		isTrustedArtifact(artifact, String(repositoryId)),
	);
	const referencedAttempt = trustedAttempts.find(
		(artifact) => artifact.id === receipt.attemptArtifactId,
	);
	if (
		!referencedAttempt ||
		referencedAttempt.expired ||
		referencedAttempt.workflowRunId !== selection.workflowRunId ||
		Date.parse(referencedAttempt.createdAt) >= Date.parse(selection.createdAt)
	) {
		return false;
	}

	return true;
}

function normalizeArtifactPages(payload, expectedName, state) {
	const pages = Array.isArray(payload) ? payload : [payload];
	return pages.flatMap((page) =>
		Array.isArray(page?.artifacts)
			? page.artifacts
					.filter((artifact) => artifact?.name === expectedName)
					.map((artifact) => ({
						id: normalizePositiveInteger(artifact.id, 'artifact ID'),
						name: expectedName,
						state,
						expired: artifact.expired === true,
						createdAt: normalizeTimestamp(artifact.created_at),
						workflowRunId: normalizePositiveInteger(
							artifact.workflow_run?.id,
							'artifact workflow run ID',
						),
						repositoryId: normalizePositiveInteger(
							artifact.workflow_run?.repository_id,
							'artifact repository ID',
						),
						headRepositoryId: normalizePositiveInteger(
							artifact.workflow_run?.head_repository_id,
							'artifact head repository ID',
						),
						headBranch: String(
							artifact.workflow_run?.head_branch || '',
						),
					}))
			: [],
	);
}

function isTrustedArtifact(artifact, repositoryId) {
	return (
		artifact.repositoryId === repositoryId &&
		artifact.headRepositoryId === repositoryId &&
		artifact.headBranch === 'main'
	);
}

function normalizeWorkflowRun(payload) {
	return {
		id: normalizePositiveInteger(payload?.id, 'workflow run ID'),
		attempt: Number(
			normalizePositiveInteger(
				payload?.run_attempt,
				'workflow run attempt',
			),
		),
		repositoryId: normalizePositiveInteger(
			payload?.repository?.id,
			'workflow repository ID',
		),
		headRepositoryId: normalizePositiveInteger(
			payload?.head_repository?.id,
			'workflow head repository ID',
		),
		headBranch: String(payload?.head_branch || ''),
		status: String(payload?.status || ''),
		conclusion: String(payload?.conclusion || ''),
		path: String(payload?.path || ''),
		event: String(payload?.event || ''),
	};
}

function normalizeCommit(value, label) {
	const commit = String(value || '').trim().toLowerCase();
	if (!COMMIT_PATTERN.test(commit)) {
		throw new Error(`${label} commit must be a full Git SHA.`);
	}
	return commit;
}

function normalizeCorpusVersion(value) {
	const version = String(value || '').trim().toLowerCase();
	if (!CORPUS_VERSION_PATTERN.test(version)) {
		throw new Error('Corpus version must contain 20 hexadecimal characters.');
	}
	return version;
}

function normalizeSha256(value) {
	const digest = String(value || '').trim().toLowerCase();
	if (!SHA256_PATTERN.test(digest)) {
		throw new Error('Corpus SHA-256 must contain 64 hexadecimal characters.');
	}
	return digest;
}

function normalizeVectorCount(value) {
	const count = Number(value);
	if (!Number.isSafeInteger(count) || count < 1) {
		throw new Error('Vector count must be a positive integer.');
	}
	return count;
}

function normalizePositiveInteger(value, label) {
	const integer = String(value ?? '').trim();
	if (!POSITIVE_INTEGER_PATTERN.test(integer)) {
		throw new Error(`${label} must be a positive integer.`);
	}
	return integer;
}

function normalizeTimestamp(value) {
	const timestamp = String(value || '');
	if (!Number.isFinite(Date.parse(timestamp))) {
		throw new Error('Artifact creation time is invalid.');
	}
	return timestamp;
}

async function readJson(path) {
	return JSON.parse(await readFile(resolve(path), 'utf8'));
}

async function writeStateFromCorpus({
	state,
	corpusFile,
	corpusSha256,
	workflowRunId,
	workflowRunAttempt,
	attemptArtifactId,
	outputFile,
}) {
	const corpus = await readJson(corpusFile);
	const payload = createProductionSyncState({
		state,
		siteCommit: corpus.siteCommit,
		contentCommit: corpus.contentCommit,
		corpusVersion: corpus.version,
		corpusSha256,
		vectorCount: corpus.vectorCount,
		workflowRunId,
		workflowRunAttempt,
		attemptArtifactId,
	});
	const destination = resolve(outputFile);
	await mkdir(dirname(destination), { recursive: true });
	await writeFile(destination, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function isDirectExecution() {
	if (!process.argv[1]) return false;
	return (
		resolve(process.argv[1]).toLowerCase() ===
		fileURLToPath(import.meta.url).toLowerCase()
	);
}

if (isDirectExecution()) {
	const command = process.argv[2];

	if (command === 'select-latest-success') {
		const [attemptsFile, successesFile, repositoryId] = process.argv.slice(3);
		const selection = selectLatestTrustedProductionSyncEvent(
			{
				attemptArtifacts: await readJson(attemptsFile),
				successArtifacts: await readJson(successesFile),
			},
			{ repositoryId },
		);
		if (
			selection.status === 'candidate' &&
			selection.state === 'success' &&
			!selection.expired
		) {
			console.log(`${selection.id} ${selection.workflowRunId}`);
		}
	} else if (command === 'verify-success') {
		const [
			receiptFile,
			attemptsFile,
			successesFile,
			workflowRunFile,
			repositoryId,
			siteCommit,
			contentCommit,
			corpusVersion,
			corpusSha256,
		] = process.argv.slice(3);
		const matches = verifyLatestProductionSyncSuccess({
			attemptArtifacts: await readJson(attemptsFile),
			successArtifacts: await readJson(successesFile),
			repositoryId,
			receiptText: await readFile(resolve(receiptFile), 'utf8'),
			workflowRun: await readJson(workflowRunFile),
			expected: {
				siteCommit,
				contentCommit,
				corpusVersion,
				corpusSha256: corpusSha256 || undefined,
			},
		});
		if (!matches) process.exitCode = 1;
	} else if (command === 'write-attempt' || command === 'write-success') {
		const [
			corpusFile,
			corpusSha256,
			workflowRunId,
			workflowRunAttempt,
			fifth,
			sixth,
		] = process.argv.slice(3);
		await writeStateFromCorpus({
			state: command === 'write-attempt' ? 'attempt' : 'success',
			corpusFile,
			corpusSha256,
			workflowRunId,
			workflowRunAttempt,
			attemptArtifactId: command === 'write-success' ? fifth : undefined,
			outputFile: command === 'write-success' ? sixth : fifth,
		});
	} else {
		throw new Error(
			'Usage: production-sync-state.mjs <select-latest-success|verify-success|write-attempt|write-success> ...',
		);
	}
}
