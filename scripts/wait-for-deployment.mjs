import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;
const CORPUS_VERSION_PATTERN = /^[0-9a-f]{20}$/i;
const MAX_MARKER_BYTES = 4096;

export function parseBuildMetadata(text) {
	if (Buffer.byteLength(text, 'utf8') > MAX_MARKER_BYTES) {
		throw new Error('Pages build marker is unexpectedly large.');
	}

	const payload = JSON.parse(text);
	const siteCommit = normalizeCommit(payload?.siteCommit, 'site');
	const contentCommit = normalizeCommit(payload?.contentCommit, 'content');
	const searchCorpusVersion = String(payload?.searchCorpusVersion || '')
		.trim()
		.toLowerCase();

	if (
		payload?.schemaVersion !== 1 ||
		!CORPUS_VERSION_PATTERN.test(searchCorpusVersion)
	) {
		throw new Error(
			'Pages build marker must contain schema version 1 and a 20-character search corpus version.',
		);
	}

	return {
		schemaVersion: 1,
		siteCommit,
		contentCommit,
		searchCorpusVersion,
	};
}

export async function readDeployedBuild(
	targetUrl,
	{
		fetchImpl = globalThis.fetch,
		fetchTimeoutMs = Number(process.env.DEPLOYMENT_FETCH_TIMEOUT_MS || 10_000),
	} = {},
) {
	const url = new URL(targetUrl);
	if (url.protocol !== 'https:') {
		throw new Error('Pages build marker URL must use HTTPS.');
	}

	const response = await fetchImpl(url, {
		headers: {
			Accept: 'application/json',
			'Cache-Control': 'no-cache, no-store',
		},
		cache: 'no-store',
		signal: AbortSignal.timeout(fetchTimeoutMs),
	});
	if (!response.ok) {
		throw new Error(`Pages build marker returned HTTP ${response.status}.`);
	}

	return parseBuildMetadata(await response.text());
}

export async function assertDeployedBuild(
	targetUrl,
	expected,
	{
		fetchImpl = globalThis.fetch,
		fetchTimeoutMs = Number(process.env.DEPLOYMENT_FETCH_TIMEOUT_MS || 10_000),
		logger = console,
	} = {},
) {
	const normalizedExpected = normalizeExpectedBuild(expected);
	const deployed = await readDeployedBuild(targetUrl, {
		fetchImpl,
		fetchTimeoutMs,
	});

	if (
		deployed.siteCommit !== normalizedExpected.siteCommit ||
		deployed.contentCommit !== normalizedExpected.contentCommit ||
		deployed.searchCorpusVersion !== normalizedExpected.searchCorpusVersion
	) {
		throw new Error(
			'Production changed or its content/search corpus differs from the corpus built by this workflow.',
		);
	}

	logger.log(
		JSON.stringify({ event: 'pages_build_confirmed', ...normalizedExpected }),
	);
	return deployed;
}

export async function waitForDeployment(
	targetUrl,
	expectedSiteCommit,
	{
		timeoutMs = Number(process.env.DEPLOYMENT_WAIT_TIMEOUT_MS || 600_000),
		pollMs = Number(process.env.DEPLOYMENT_WAIT_POLL_MS || 15_000),
		fetchImpl = globalThis.fetch,
		fetchTimeoutMs = Number(process.env.DEPLOYMENT_FETCH_TIMEOUT_MS || 10_000),
		logger = console,
		sleepImpl = (milliseconds) =>
			new Promise((resolvePromise) =>
				setTimeout(resolvePromise, milliseconds),
			),
	} = {},
) {
	const normalizedExpectedCommit = normalizeCommit(
		expectedSiteCommit,
		'expected site',
	);
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		try {
			const deployed = await readDeployedBuild(targetUrl, {
				fetchImpl,
				fetchTimeoutMs,
			});
			if (deployed.siteCommit === normalizedExpectedCommit) {
				logger.log(
					JSON.stringify({
						event: 'pages_deployment_ready',
						...deployed,
					}),
				);
				return deployed;
			}
		} catch {
			// A deployment can be temporarily unreachable while Cloudflare promotes it.
		}

		await sleepImpl(pollMs);
	}

	throw new Error(
		`Timed out waiting for Pages deployment ${normalizedExpectedCommit}.`,
	);
}

function normalizeExpectedBuild(value) {
	const searchCorpusVersion = String(value?.version || value?.searchCorpusVersion || '')
		.trim()
		.toLowerCase();
	if (!CORPUS_VERSION_PATTERN.test(searchCorpusVersion)) {
		throw new Error(
			'Expected build must contain a 20-character search corpus version.',
		);
	}

	return {
		siteCommit: normalizeCommit(value?.siteCommit, 'site'),
		contentCommit: normalizeCommit(value?.contentCommit, 'content'),
		searchCorpusVersion,
	};
}

function normalizeCommit(value, label) {
	const commit = String(value || '').trim().toLowerCase();
	if (!COMMIT_PATTERN.test(commit)) {
		throw new Error(
			`Pages build marker must contain a full 40-character ${label} commit.`,
		);
	}
	return commit;
}

function isDirectExecution() {
	if (!process.argv[1]) return false;
	return (
		resolve(process.argv[1]).toLowerCase() ===
		fileURLToPath(import.meta.url).toLowerCase()
	);
}

if (isDirectExecution()) {
	const targetUrl = process.argv[2];
	const command = process.argv[3];

	if (!targetUrl || !command) {
		throw new Error(
			'Usage: node scripts/wait-for-deployment.mjs <build-meta-url> <site-commit|--print-current|--assert-current> [corpus-file]',
		);
	}

	if (command === '--print-current') {
		console.log(JSON.stringify(await readDeployedBuild(targetUrl)));
	} else if (command === '--assert-current') {
		const corpusFile = process.argv[4];
		if (!corpusFile) {
			throw new Error('--assert-current requires a corpus JSON file.');
		}
		const corpus = JSON.parse(await readFile(resolve(corpusFile), 'utf8'));
		await assertDeployedBuild(targetUrl, corpus);
	} else {
		await waitForDeployment(targetUrl, command);
	}
}
