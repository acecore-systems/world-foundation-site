import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	SEARCH_CHUNK_MAXIMUM_CHARACTERS,
	SEARCH_CHUNK_OVERLAP_CHARACTERS,
	SEARCH_CHUNK_TARGET_CHARACTERS,
	SEARCH_CORPUS_SCHEMA_VERSION,
	SEARCH_DISTANCE_METRIC,
	SEARCH_EMBEDDING_DIMENSIONS,
	SEARCH_EMBEDDING_MODEL,
	SEARCH_VECTOR_ID_HASH_CHARACTERS,
	SEARCH_VECTOR_ID_PREFIX,
	SEARCH_VECTOR_LIMIT,
	createSearchCorpusVersion,
	createSearchVectorId,
} from './search-contract.mjs';

const API_BASE_URL = 'https://api.cloudflare.com/client/v4';
export const ACECORE_CLOUDFLARE_ACCOUNT_ID =
	'db9b62f409f463da7acbcc374b8385d0';
const DEFAULT_CORPUS_FILE = resolve('.vectorize/corpus.json');
const EMBEDDING_BATCH_SIZE = 32;
const UPSERT_BATCH_SIZE = 200;
const DELETE_BATCH_SIZE = 100;
const LIST_BATCH_SIZE = 1000;
const CONVERGENCE_WAIT_TIMEOUT_MS = 180_000;
const CONVERGENCE_POLL_INTERVAL_MS = 5_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REQUEST_RETRIES = 5;
const RETRY_BASE_DELAY_MS = 500;
const MAX_LIST_CURSOR_RESTARTS = 3;
const MAX_DELETE_RATIO = 0.2;
const MIN_SOURCE_COUNT = 60;
const MIN_VECTOR_COUNT = 80;
const MIN_LOCALE_VECTOR_COUNTS = { ja: 40, en: 15 };
const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;
const CORPUS_VERSION_PATTERN = /^[0-9a-f]{20}$/;
const MANAGED_VECTOR_ID_PATTERN = new RegExp(
	`^${escapeRegExp(SEARCH_VECTOR_ID_PREFIX)}[0-9a-f]{${SEARCH_VECTOR_ID_HASH_CHARACTERS}}$`,
);
const TARGET_INDEX_NAMES = Object.freeze({
	preview: 'world-foundation-search-preview',
	production: 'world-foundation-search-production',
});
const SUPPORTED_LOCALES = ['ja', 'en'];

class CloudflareApiError extends Error {
	constructor(message, status) {
		super(message);
		this.name = 'CloudflareApiError';
		this.status = status;
	}
}

export async function syncVectorize({
	accountId = process.env.CLOUDFLARE_ACCOUNT_ID,
	apiToken = process.env.CLOUDFLARE_API_TOKEN,
	target = process.env.VECTORIZE_TARGET,
	confirmProduction = process.env.VECTORIZE_CONFIRM_PRODUCTION,
	expectedSiteCommit = process.env.VECTORIZE_EXPECTED_SITE_COMMIT,
	expectedContentCommit = process.env.VECTORIZE_EXPECTED_CONTENT_COMMIT,
	expectedCorpusVersion = process.env.VECTORIZE_EXPECTED_CORPUS_VERSION,
	corpusFile = DEFAULT_CORPUS_FILE,
	dryRun = false,
	allowLargeDelete = false,
	fetchImpl = globalThis.fetch,
	requestTimeoutMs = REQUEST_TIMEOUT_MS,
	retryBaseDelayMs = RETRY_BASE_DELAY_MS,
	convergenceWaitTimeoutMs = CONVERGENCE_WAIT_TIMEOUT_MS,
	convergencePollIntervalMs = CONVERGENCE_POLL_INTERVAL_MS,
	sleepImpl = sleep,
	nowImpl = Date.now,
	randomImpl = Math.random,
	logger = console,
} = {}) {
	const corpus = JSON.parse(await readFile(corpusFile, 'utf8'));
	validateCorpus(corpus);
	const normalizedTarget = normalizeTarget(target);
	const indexName = TARGET_INDEX_NAMES[normalizedTarget];
	validateProductionConfirmation({
		target: normalizedTarget,
		confirmation: confirmProduction,
		corpusVersion: corpus.version,
	});
	validateAccountId(accountId, { required: !dryRun });
	validateExpectedCorpusIdentity({
		corpus,
		expectedSiteCommit,
		expectedContentCommit,
		expectedCorpusVersion,
		required: !dryRun,
	});

	if (!dryRun && !apiToken) {
		throw new Error(
			'CLOUDFLARE_API_TOKEN is required for a live Vectorize sync.',
		);
	}

	if (dryRun) {
		const result = {
			dryRun: true,
			target: normalizedTarget,
			indexName,
			corpusVersion: corpus.version,
			siteCommit: corpus.siteCommit,
			contentCommit: corpus.contentCommit,
			vectors: corpus.vectorCount,
			locales: corpus.localeCounts,
		};
		logger.log(JSON.stringify({ event: 'vectorize_sync_dry_run', ...result }));
		return result;
	}

	if (typeof fetchImpl !== 'function') {
		throw new Error('A Fetch API implementation is required.');
	}

	const client = createCloudflareClient({
		accountId: ACECORE_CLOUDFLARE_ACCOUNT_ID,
		apiToken,
		fetchImpl,
		requestTimeoutMs,
		retryBaseDelayMs,
		sleepImpl,
		randomImpl,
	});
	const index = await getRequiredIndex(client, indexName);
	validateIndexConfiguration(index, indexName);

	const currentIds = await listVectorIds(client, indexName, {
		logger,
		sleepImpl,
		retryBaseDelayMs,
	});
	validateExistingVectorIds(currentIds, indexName);

	const expectedIds = new Set(corpus.chunks.map(({ id }) => id));
	const chunksToUpsert = corpus.chunks.filter(({ id }) => !currentIds.has(id));
	const idsToDelete = [...currentIds].filter((id) => !expectedIds.has(id));
	validateDeletePlan({
		currentCount: currentIds.size,
		deleteCount: idsToDelete.length,
		allowLargeDelete,
	});

	logger.log(
		JSON.stringify({
			event: 'vectorize_sync_plan',
			target: normalizedTarget,
			indexName,
			corpusVersion: corpus.version,
			current: currentIds.size,
			expected: expectedIds.size,
			upsert: chunksToUpsert.length,
			delete: idsToDelete.length,
		}),
	);

	const mutationIds = [];
	const vectorsToUpsert = [];
	for (const chunkBatch of batches(chunksToUpsert, EMBEDDING_BATCH_SIZE)) {
		const embeddings = await createEmbeddings(client, chunkBatch);
		vectorsToUpsert.push(
			...chunkBatch.map((chunk, index) => ({
				id: chunk.id,
				values: embeddings[index],
				namespace: chunk.namespace,
				metadata: chunk.metadata,
			})),
		);
	}

	for (const vectorBatch of batches(vectorsToUpsert, UPSERT_BATCH_SIZE)) {
		const mutationId = await upsertVectors(client, indexName, vectorBatch);
		mutationIds.push(mutationId);
	}

	for (const idBatch of batches(idsToDelete, DELETE_BATCH_SIZE)) {
		const mutationId = await deleteVectors(client, indexName, idBatch);
		mutationIds.push(mutationId);
	}

	const lastMutationId = mutationIds.at(-1);
	if (lastMutationId) {
		await waitForExactVectorIds(client, indexName, expectedIds, {
			timeoutMs: convergenceWaitTimeoutMs,
			pollIntervalMs: convergencePollIntervalMs,
			sleepImpl,
			nowImpl,
			logger,
			retryBaseDelayMs,
		});
	}

	const result = {
		dryRun: false,
		target: normalizedTarget,
		indexName,
		corpusVersion: corpus.version,
		existing: currentIds.size,
		upserted: chunksToUpsert.length,
		deleted: idsToDelete.length,
		mutationId: lastMutationId || null,
		verifiedVectorCount: expectedIds.size,
	};
	logger.log(JSON.stringify({ event: 'vectorize_sync_complete', ...result }));
	return result;
}

export function validateCorpus(corpus) {
	if (corpus?.schemaVersion !== SEARCH_CORPUS_SCHEMA_VERSION) {
		throw new Error(
			`Corpus schemaVersion must be ${SEARCH_CORPUS_SCHEMA_VERSION}.`,
		);
	}
	if (
		typeof corpus?.version !== 'string' ||
		!CORPUS_VERSION_PATTERN.test(corpus.version) ||
		!COMMIT_PATTERN.test(corpus?.siteCommit || '') ||
		!COMMIT_PATTERN.test(corpus?.contentCommit || '')
	) {
		throw new Error(
			'Corpus must include a 20-character hexadecimal version and full 40-character siteCommit and contentCommit values.',
		);
	}
	if (
		corpus?.embedding?.model !== SEARCH_EMBEDDING_MODEL ||
		corpus?.embedding?.dimensions !== SEARCH_EMBEDDING_DIMENSIONS ||
		corpus?.embedding?.metric !== SEARCH_DISTANCE_METRIC
	) {
		throw new Error(
			`Corpus embedding configuration must be ${SEARCH_EMBEDDING_MODEL}, ${SEARCH_EMBEDDING_DIMENSIONS} dimensions, ${SEARCH_DISTANCE_METRIC}.`,
		);
	}
	if (
		corpus?.chunking?.targetCharacters !==
			SEARCH_CHUNK_TARGET_CHARACTERS ||
		corpus?.chunking?.maximumCharacters !==
			SEARCH_CHUNK_MAXIMUM_CHARACTERS ||
		corpus?.chunking?.overlapCharacters !==
			SEARCH_CHUNK_OVERLAP_CHARACTERS
	) {
		throw new Error(
			`Corpus chunking configuration must be ${SEARCH_CHUNK_TARGET_CHARACTERS}/${SEARCH_CHUNK_MAXIMUM_CHARACTERS}/${SEARCH_CHUNK_OVERLAP_CHARACTERS}.`,
		);
	}
	if (!Array.isArray(corpus.chunks)) {
		throw new Error('Corpus chunks must be an array.');
	}
	if (
		!Number.isInteger(corpus.sourceCount) ||
		corpus.sourceCount < MIN_SOURCE_COUNT
	) {
		throw new Error(
			`Corpus must contain at least ${MIN_SOURCE_COUNT} source documents.`,
		);
	}
	if (
		!Number.isInteger(corpus.vectorCount) ||
		corpus.chunks.length !== corpus.vectorCount ||
		corpus.chunks.length < MIN_VECTOR_COUNT ||
		corpus.chunks.length > SEARCH_VECTOR_LIMIT
	) {
		throw new Error(
			`Corpus vector count must be between ${MIN_VECTOR_COUNT} and ${SEARCH_VECTOR_LIMIT}.`,
		);
	}

	const ids = new Set();
	const sourceUrls = new Set();
	const chunkIndexesBySource = new Map();
	const actualLocaleCounts = Object.fromEntries(
		SUPPORTED_LOCALES.map((locale) => [locale, 0]),
	);
	for (const chunk of corpus.chunks) {
		if (
			typeof chunk?.id !== 'string' ||
			!MANAGED_VECTOR_ID_PATTERN.test(chunk.id) ||
			!SUPPORTED_LOCALES.includes(chunk?.namespace) ||
			typeof chunk?.text !== 'string' ||
			!chunk.text.trim() ||
			chunk.text.length > SEARCH_CHUNK_MAXIMUM_CHARACTERS ||
			!chunk.metadata ||
			typeof chunk.metadata.url !== 'string' ||
			typeof chunk.metadata.title !== 'string' ||
			typeof chunk.metadata.section !== 'string' ||
			typeof chunk.metadata.excerpt !== 'string' ||
			chunk.metadata.locale !== chunk.namespace
		) {
			throw new Error('Corpus contains an invalid chunk.');
		}
		const sourceKey = `${chunk.namespace}\n${chunk.metadata.url}`;
		const chunkIndex = chunkIndexesBySource.get(sourceKey) || 0;
		const expectedId = createSearchVectorId({
			locale: chunk.namespace,
			url: chunk.metadata.url,
			index: chunkIndex,
			text: chunk.text,
		});
		if (chunk.id !== expectedId) {
			throw new Error(
				`Corpus vector id does not match the current search contract: ${chunk.id}`,
			);
		}
		chunkIndexesBySource.set(sourceKey, chunkIndex + 1);
		if (ids.has(chunk.id)) throw new Error(`Duplicate vector id: ${chunk.id}`);
		ids.add(chunk.id);
		sourceUrls.add(chunk.metadata.url);
		actualLocaleCounts[chunk.namespace] += 1;
	}

	if (sourceUrls.size !== corpus.sourceCount) {
		throw new Error(
			`Corpus sourceCount ${corpus.sourceCount} does not match ${sourceUrls.size} unique source URLs.`,
		);
	}
	const expectedVersion = createSearchCorpusVersion({
		siteCommit: corpus.siteCommit,
		contentCommit: corpus.contentCommit,
		vectorIds: ids,
	});
	if (corpus.version !== expectedVersion) {
		throw new Error(
			`Corpus version ${corpus.version} does not match its commits and vector IDs (${expectedVersion}).`,
		);
	}

	for (const locale of SUPPORTED_LOCALES) {
		const declaredCount = corpus?.localeCounts?.[locale];
		const actualCount = actualLocaleCounts[locale];
		const minimum = MIN_LOCALE_VECTOR_COUNTS[locale];
		if (
			!Number.isInteger(declaredCount) ||
			declaredCount !== actualCount ||
			actualCount < minimum
		) {
			throw new Error(
				`Corpus locale ${locale} must contain at least ${minimum} vectors and match localeCounts.`,
			);
		}
	}
}

export function extractEmbeddingData(payload, expectedCount) {
	const result = payload?.result ?? payload;
	const data = result?.data;

	if (!Array.isArray(data) || data.length !== expectedCount) {
		throw new Error(
			`Workers AI returned ${Array.isArray(data) ? data.length : 0} embeddings; expected ${expectedCount}.`,
		);
	}

	for (const values of data) {
		if (
			!Array.isArray(values) ||
			values.length !== SEARCH_EMBEDDING_DIMENSIONS ||
			values.some((value) => !Number.isFinite(value))
		) {
			throw new Error(
				`Workers AI embedding must contain ${SEARCH_EMBEDDING_DIMENSIONS} finite values.`,
			);
		}
	}

	return data;
}

function normalizeTarget(target) {
	const normalized = String(target || '')
		.trim()
		.toLowerCase();
	if (!Object.hasOwn(TARGET_INDEX_NAMES, normalized)) {
		throw new Error('VECTORIZE_TARGET/--target must be preview or production.');
	}
	return normalized;
}

function validateAccountId(accountId, { required }) {
	if (!accountId && !required) return;
	if (accountId !== ACECORE_CLOUDFLARE_ACCOUNT_ID) {
		throw new Error(
			`CLOUDFLARE_ACCOUNT_ID must be the pinned Acecore account ${ACECORE_CLOUDFLARE_ACCOUNT_ID}.`,
		);
	}
}

function validateProductionConfirmation({
	target,
	confirmation,
	corpusVersion,
}) {
	if (target !== 'production') return;
	if (confirmation !== corpusVersion) {
		throw new Error(
			`Production sync requires --confirm-production ${corpusVersion} (or VECTORIZE_CONFIRM_PRODUCTION) matching the corpus version.`,
		);
	}
}

function validateExpectedCorpusIdentity({
	corpus,
	expectedSiteCommit,
	expectedContentCommit,
	expectedCorpusVersion,
	required,
}) {
	const supplied = [
		expectedSiteCommit,
		expectedContentCommit,
		expectedCorpusVersion,
	].some((value) => value !== undefined && value !== '');
	if (!required && !supplied) return;

	if (
		!COMMIT_PATTERN.test(expectedSiteCommit || '') ||
		!COMMIT_PATTERN.test(expectedContentCommit || '') ||
		!CORPUS_VERSION_PATTERN.test(expectedCorpusVersion || '')
	) {
		throw new Error(
			'Live sync requires full VECTORIZE_EXPECTED_SITE_COMMIT, VECTORIZE_EXPECTED_CONTENT_COMMIT, and VECTORIZE_EXPECTED_CORPUS_VERSION values.',
		);
	}
	if (
		expectedSiteCommit !== corpus.siteCommit ||
		expectedContentCommit !== corpus.contentCommit ||
		expectedCorpusVersion !== corpus.version
	) {
		throw new Error(
			'Expected site commit, content commit, and corpus version must exactly match the corpus artifact before sync.',
		);
	}
}

function validateExistingVectorIds(ids, indexName) {
	const unmanagedIds = [...ids].filter(
		(id) => !MANAGED_VECTOR_ID_PATTERN.test(id),
	);
	if (unmanagedIds.length === 0) return;

	throw new Error(
		`Vectorize index ${indexName} contains ${unmanagedIds.length} unmanaged vector id(s); refusing to mutate it.`,
	);
}

function validateDeletePlan({ currentCount, deleteCount, allowLargeDelete }) {
	if (
		deleteCount === 0 ||
		currentCount === 0 ||
		deleteCount / currentCount <= MAX_DELETE_RATIO ||
		allowLargeDelete
	) {
		return;
	}

	const percentage = ((deleteCount / currentCount) * 100).toFixed(1);
	throw new Error(
		`Refusing to delete ${deleteCount}/${currentCount} vectors (${percentage}%); pass --allow-large-delete to override the ${MAX_DELETE_RATIO * 100}% safety limit.`,
	);
}

function createCloudflareClient({
	accountId,
	apiToken,
	fetchImpl,
	requestTimeoutMs,
	retryBaseDelayMs,
	sleepImpl,
	randomImpl,
}) {
	const accountBase = `${API_BASE_URL}/accounts/${encodeURIComponent(accountId)}`;

	return {
		async request(path, init = {}) {
			const headers = new Headers(init.headers);
			headers.set('Authorization', `Bearer ${apiToken}`);
			headers.set('Accept', 'application/json');

			for (let attempt = 0; attempt <= MAX_REQUEST_RETRIES; attempt += 1) {
				const timeoutController = new AbortController();
				const timeout = setTimeout(
					() => timeoutController.abort(new Error('Request timed out.')),
					requestTimeoutMs,
				);

				try {
					const response = await fetchImpl(`${accountBase}${path}`, {
						...init,
						headers,
						signal: timeoutController.signal,
					});

					if (
						isRetryableStatus(response.status) &&
						attempt < MAX_REQUEST_RETRIES
					) {
						await response.body?.cancel().catch(() => {});
						clearTimeout(timeout);
						await sleepImpl(
							getRetryDelay({
								attempt,
								retryAfter: response.headers.get('Retry-After'),
								retryBaseDelayMs,
								randomImpl,
							}),
						);
						continue;
					}

					const payload = await readJsonResponse(response);
					if (!response.ok || payload?.success === false) {
						const message =
							payload?.errors
								?.map((error) => error?.message)
								.filter(Boolean)
								.join('; ') ||
							`Cloudflare API request failed with ${response.status}.`;
						throw new CloudflareApiError(message, response.status);
					}

					return payload;
				} catch (error) {
					if (
						attempt >= MAX_REQUEST_RETRIES ||
						!isRetryableNetworkError(
							error,
							timeoutController.signal.aborted,
						)
					) {
						throw error;
					}

					clearTimeout(timeout);
					await sleepImpl(
						getRetryDelay({
							attempt,
							retryBaseDelayMs,
							randomImpl,
						}),
					);
				} finally {
					clearTimeout(timeout);
				}
			}

			throw new Error('Cloudflare API request exhausted all retries.');
		},
	};
}

function isRetryableStatus(status) {
	return status === 429 || status >= 500;
}

function isRetryableNetworkError(error, timedOut) {
	return (
		timedOut ||
		error instanceof TypeError ||
		error?.name === 'AbortError' ||
		error?.name === 'TimeoutError'
	);
}

function getRetryDelay({
	attempt,
	retryAfter,
	retryBaseDelayMs,
	randomImpl,
}) {
	const exponentialDelay = retryBaseDelayMs * 2 ** attempt;
	const jitter = randomImpl() * retryBaseDelayMs;
	const retryAfterDelay = parseRetryAfter(retryAfter);
	return Math.max(exponentialDelay + jitter, retryAfterDelay);
}

function parseRetryAfter(value) {
	if (!value) return 0;

	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : 0;
}

function sleep(milliseconds) {
	return new Promise((resolvePromise) =>
		setTimeout(resolvePromise, milliseconds),
	);
}

async function getRequiredIndex(client, indexName) {
	const encodedName = encodeURIComponent(indexName);
	try {
		const payload = await client.request(
			`/vectorize/v2/indexes/${encodedName}`,
		);
		return payload.result;
	} catch (error) {
		if (error instanceof CloudflareApiError && error.status === 404) {
			throw new Error(
				`Vectorize index ${indexName} is not provisioned; refusing to create infrastructure during content sync.`,
				{ cause: error },
			);
		}
		throw error;
	}
}

function validateIndexConfiguration(index, indexName) {
	const config = index?.config;
	if (
		(index?.name && index.name !== indexName) ||
		config?.dimensions !== SEARCH_EMBEDDING_DIMENSIONS ||
		config?.metric !== SEARCH_DISTANCE_METRIC
	) {
		throw new Error(
			`Vectorize index ${indexName} must use ${SEARCH_EMBEDDING_DIMENSIONS} dimensions and ${SEARCH_DISTANCE_METRIC}.`,
		);
	}
}

async function listVectorIds(
	client,
	indexName,
	{ logger, sleepImpl, retryBaseDelayMs },
) {
	for (let restart = 0; restart <= MAX_LIST_CURSOR_RESTARTS; restart += 1) {
		try {
			return await listVectorIdsOnce(client, indexName);
		} catch (error) {
			if (
				restart >= MAX_LIST_CURSOR_RESTARTS ||
				!(error instanceof CloudflareApiError) ||
				error.status !== 400 ||
				!/cursor/i.test(error.message)
			) {
				throw error;
			}

			logger.log(
				JSON.stringify({
					event: 'vectorize_list_cursor_restart',
					indexName,
					restart: restart + 1,
				}),
			);
			await sleepImpl(retryBaseDelayMs * 2 ** restart);
		}
	}

	throw new Error('Vectorize list pagination exhausted all cursor restarts.');
}

async function listVectorIdsOnce(client, indexName) {
	const ids = new Set();
	let cursor = '';

	do {
		const query = new URLSearchParams({ count: String(LIST_BATCH_SIZE) });
		if (cursor) query.set('cursor', cursor);
		const payload = await client.request(
			`/vectorize/v2/indexes/${encodeURIComponent(indexName)}/list?${query}`,
		);
		const result = payload?.result || {};
		if (!Array.isArray(result.vectors)) {
			throw new Error(
				`Vectorize index ${indexName} returned an invalid vector list.`,
			);
		}

		for (const vector of result.vectors) {
			if (typeof vector?.id !== 'string') {
				throw new Error(
					`Vectorize index ${indexName} returned a vector without a valid id; refusing to mutate it.`,
				);
			}
			ids.add(vector.id);
		}

		if (result.isTruncated) {
			if (
				typeof result.nextCursor !== 'string' ||
				!result.nextCursor.trim()
			) {
				throw new Error(
					`Vectorize index ${indexName} returned a truncated page without a cursor.`,
				);
			}
			cursor = result.nextCursor;
		} else {
			cursor = '';
		}
	} while (cursor);

	return ids;
}

async function createEmbeddings(client, chunks) {
	const payload = await client.request(`/ai/run/${SEARCH_EMBEDDING_MODEL}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			text: chunks.map(({ text }) => text),
			truncate_inputs: true,
		}),
	});
	return extractEmbeddingData(payload, chunks.length);
}

async function upsertVectors(client, indexName, vectors) {
	if (vectors.length > UPSERT_BATCH_SIZE) {
		throw new Error(`Refusing to upsert more than ${UPSERT_BATCH_SIZE} vectors.`);
	}
	const ndjson = vectors.map((vector) => JSON.stringify(vector)).join('\n');
	const form = new FormData();
	form.set(
		'vectors',
		new Blob([`${ndjson}\n`], { type: 'application/x-ndjson' }),
		'vectors.ndjson',
	);
	const payload = await client.request(
		`/vectorize/v2/indexes/${encodeURIComponent(indexName)}/upsert`,
		{
			method: 'POST',
			body: form,
		},
	);
	return getMutationId(payload);
}

async function deleteVectors(client, indexName, ids) {
	if (ids.length > DELETE_BATCH_SIZE) {
		throw new Error(`Refusing to delete more than ${DELETE_BATCH_SIZE} vectors.`);
	}
	const payload = await client.request(
		`/vectorize/v2/indexes/${encodeURIComponent(indexName)}/delete_by_ids`,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ids }),
		},
	);
	return getMutationId(payload);
}

function getMutationId(payload) {
	const value = payload?.result?.mutationId ?? payload?.mutationId;
	if (typeof value !== 'string' || !value.trim()) {
		throw new Error(
			'Cloudflare Vectorize mutation response did not include a valid mutationId.',
		);
	}
	return value;
}

async function waitForExactVectorIds(
	client,
	indexName,
	expectedIds,
	{
		timeoutMs,
		pollIntervalMs,
		sleepImpl,
		nowImpl,
		logger,
		retryBaseDelayMs,
	},
) {
	const deadline = nowImpl() + timeoutMs;
	let lastMissingCount = expectedIds.size;
	let lastUnexpectedCount = 0;

	while (true) {
		const actualIds = await listVectorIds(client, indexName, {
			logger,
			sleepImpl,
			retryBaseDelayMs,
		});
		validateExistingVectorIds(actualIds, indexName);

		const missingIds = setDifference(expectedIds, actualIds);
		const unexpectedIds = setDifference(actualIds, expectedIds);
		lastMissingCount = missingIds.length;
		lastUnexpectedCount = unexpectedIds.length;
		if (missingIds.length === 0 && unexpectedIds.length === 0) return;

		const remainingMs = deadline - nowImpl();
		if (remainingMs <= 0) break;

		logger.log(
			JSON.stringify({
				event: 'vectorize_sync_convergence_wait',
				indexName,
				expected: expectedIds.size,
				actual: actualIds.size,
				missing: missingIds.length,
				unexpected: unexpectedIds.length,
			}),
		);
		await sleepImpl(Math.min(pollIntervalMs, remainingMs));
	}

	throw new Error(
		`Vectorize index ${indexName} did not converge to the expected ID set before timeout (missing ${lastMissingCount}, unexpected ${lastUnexpectedCount}).`,
	);
}

async function readJsonResponse(response) {
	const text = await response.text();
	if (!text) return null;

	try {
		return JSON.parse(text);
	} catch {
		throw new Error(
			`Cloudflare API returned a non-JSON response with ${response.status}.`,
		);
	}
}

function batches(items, size) {
	const result = [];
	for (let index = 0; index < items.length; index += size) {
		result.push(items.slice(index, index + size));
	}
	return result;
}

function setDifference(left, right) {
	return [...left].filter((value) => !right.has(value));
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseArguments(argv) {
	const options = {
		dryRun: false,
		allowLargeDelete: false,
		target: process.env.VECTORIZE_TARGET,
		confirmProduction: process.env.VECTORIZE_CONFIRM_PRODUCTION,
		expectedSiteCommit: process.env.VECTORIZE_EXPECTED_SITE_COMMIT,
		expectedContentCommit: process.env.VECTORIZE_EXPECTED_CONTENT_COMMIT,
		expectedCorpusVersion: process.env.VECTORIZE_EXPECTED_CORPUS_VERSION,
		corpusFile: DEFAULT_CORPUS_FILE,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === '--dry-run') options.dryRun = true;
		else if (argument === '--allow-large-delete') {
			options.allowLargeDelete = true;
		} else if (argument === '--target') {
			options.target = requireArgumentValue(argv, ++index, argument);
		} else if (argument === '--confirm-production') {
			options.confirmProduction = requireArgumentValue(
				argv,
				++index,
				argument,
			);
		} else if (argument === '--expected-site-commit') {
			options.expectedSiteCommit = requireArgumentValue(
				argv,
				++index,
				argument,
			);
		} else if (argument === '--expected-content-commit') {
			options.expectedContentCommit = requireArgumentValue(
				argv,
				++index,
				argument,
			);
		} else if (argument === '--expected-corpus-version') {
			options.expectedCorpusVersion = requireArgumentValue(
				argv,
				++index,
				argument,
			);
		} else if (argument === '--corpus') {
			options.corpusFile = resolve(
				requireArgumentValue(argv, ++index, argument),
			);
		} else {
			throw new Error(`Unknown argument: ${argument}`);
		}
	}

	return options;
}

function requireArgumentValue(argv, index, argument) {
	const value = argv[index];
	if (!value || value.startsWith('--')) {
		throw new Error(`${argument} requires a value.`);
	}
	return value;
}

function isDirectExecution() {
	if (!process.argv[1]) return false;
	return (
		resolve(process.argv[1]).toLowerCase() ===
		fileURLToPath(import.meta.url).toLowerCase()
	);
}

if (isDirectExecution()) {
	await syncVectorize(parseArguments(process.argv.slice(2)));
}
