import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import {
	ACECORE_CLOUDFLARE_ACCOUNT_ID,
	extractEmbeddingData,
	parseArguments,
	syncVectorize,
	validateCorpus,
} from '../scripts/sync-vectorize.mjs';
import {
	createSearchCorpusVersion,
	createSearchVectorId,
} from '../scripts/search-contract.mjs';

const PRODUCTION_INDEX = 'world-foundation-search-bge-m3-1024-production-v1';
const WORKERS_AI_ENDPOINT = `https://api.cloudflare.com/client/v4/accounts/${ACECORE_CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/baai/bge-m3`;
const temporaryRoots = [];
const embedding = Array.from({ length: 1024 }, () => 0.01);

after(async () => {
	await Promise.all(
		temporaryRoots.map((directory) =>
			rm(directory, { force: true, recursive: true }),
		),
	);
});

test('Workers AI embeddingの件数・1024次元・有限値を検証する', () => {
	assert.deepEqual(
		extractEmbeddingData(
			{ data: [embedding], shape: [1, 1024], pooling: 'cls' },
			1,
		),
		[embedding],
	);
	assert.deepEqual(
		extractEmbeddingData(
			{
				data: [embedding, embedding.map(() => 0.02)],
				shape: [2, 1024],
				pooling: 'cls',
			},
			2,
		),
		[embedding, embedding.map(() => 0.02)],
	);
	assert.throws(() => extractEmbeddingData({ data: [[0.1]] }, 1), /1024/);
	const invalid = [...embedding];
	invalid[0] = Number.NaN;
	assert.throws(() => extractEmbeddingData({ data: [invalid] }, 1), /finite/);
	assert.throws(
		() =>
			extractEmbeddingData(
				{ data: [embedding, embedding], shape: [1, 1024] },
				2,
			),
		/invalid embedding shape/,
	);
});

test('CLIはtarget・production確認・artifact identityだけを明示入力として受け付ける', () => {
	const options = parseArguments([
		'--dry-run',
		'--target',
		'production',
		'--confirm-production',
		'a'.repeat(20),
		'--expected-site-commit',
		'b'.repeat(40),
		'--expected-content-commit',
		'c'.repeat(40),
		'--expected-corpus-version',
		'a'.repeat(20),
		'--corpus',
		'fixture-corpus.json',
	]);

	assert.equal(options.dryRun, true);
	assert.equal(options.target, 'production');
	assert.equal(options.confirmProduction, 'a'.repeat(20));
	assert.equal(options.expectedSiteCommit, 'b'.repeat(40));
	assert.equal(options.expectedContentCommit, 'c'.repeat(40));
	assert.equal(options.expectedCorpusVersion, 'a'.repeat(20));
	assert.match(options.corpusFile, /fixture-corpus\.json$/);
	assert.throws(
		() => parseArguments(['--index', PRODUCTION_INDEX]),
		/Unknown argument: --index/,
	);
});

test('dry-runはcredentialもnetworkも要求せずproduction mappingだけを受け付ける', async () => {
	const corpus = createCorpus();
	const corpusFile = await writeCorpus(corpus);
	let networkCalls = 0;

	const result = await syncVectorize({
		corpusFile,
		dryRun: true,
		target: 'production',
		fetchImpl() {
			networkCalls += 1;
			throw new Error('network must not be called');
		},
		logger: silentLogger,
	});
	assert.equal(result.dryRun, true);
	assert.equal(result.target, 'production');
	assert.equal(result.indexName, PRODUCTION_INDEX);
	assert.equal(result.vectors, 80);
	assert.equal(networkCalls, 0);

	await assert.doesNotReject(
		syncVectorize({
			corpusFile,
			dryRun: true,
			target: 'production',
			logger: silentLogger,
		}),
	);
	await assert.rejects(
		syncVectorize({
			corpusFile,
			dryRun: true,
			target: 'untrusted',
			logger: silentLogger,
		}),
		/must be production/,
	);
	await assert.rejects(
		syncVectorize({
			corpusFile,
			dryRun: true,
			logger: silentLogger,
		}),
		/must be production/,
	);
});

test('Acecore account・production確認・corpus artifact identityをnetwork前に固定する', async () => {
	const corpus = createCorpus();
	const corpusFile = await writeCorpus(corpus);
	let networkCalls = 0;
	const fetchImpl = () => {
		networkCalls += 1;
		throw new Error('network must not be called');
	};

	await assert.rejects(
		syncVectorize({
			...liveSyncOptions(corpus, corpusFile, {
				accountId: '0'.repeat(32),
			}),
			fetchImpl,
			logger: silentLogger,
		}),
		/pinned Acecore account/,
	);
	await assert.rejects(
		syncVectorize({
			...liveSyncOptions(corpus, corpusFile, {
				confirmProduction: undefined,
			}),
			fetchImpl,
			logger: silentLogger,
		}),
		/confirm-production/,
	);
	await assert.rejects(
		syncVectorize({
			...liveSyncOptions(corpus, corpusFile, {
				expectedCorpusVersion: 'd'.repeat(20),
			}),
			fetchImpl,
			logger: silentLogger,
		}),
		/must exactly match the corpus artifact/,
	);
	await assert.rejects(
		syncVectorize({
			...liveSyncOptions(corpus, corpusFile, {
				expectedContentCommit: undefined,
			}),
			fetchImpl,
			logger: silentLogger,
		}),
		/requires full VECTORIZE_EXPECTED/,
	);
	await assert.rejects(
		syncVectorize({
			...liveSyncOptions(corpus, corpusFile, {
				trustedAutomation: false,
			}),
			fetchImpl,
			logger: silentLogger,
		}),
		/requires GitHub Actions mode/,
	);
	assert.equal(networkCalls, 0);
});

test('source・vector・日英localeの最低件数とvector上限を検証する', () => {
	const tooFewSources = createCorpus();
	tooFewSources.sourceCount = 59;
	assert.throws(() => validateCorpus(tooFewSources), /at least 60/);

	const tooFewVectors = createCorpus({ vectorCount: 79 });
	assert.throws(() => validateCorpus(tooFewVectors), /between 80 and 1000/);

	const tooFewJapanese = createCorpus({
		vectorCount: 80,
		japaneseCount: 39,
	});
	assert.throws(() => validateCorpus(tooFewJapanese), /locale ja/);

	const tooFewEnglish = createCorpus({
		vectorCount: 80,
		japaneseCount: 66,
	});
	assert.throws(() => validateCorpus(tooFewEnglish), /locale en/);

	const tooManyVectors = createCorpus({
		vectorCount: 1001,
		japaneseCount: 700,
	});
	assert.throws(() => validateCorpus(tooManyVectors), /between 80 and 1000/);

	const staleContractId = createCorpus();
	staleContractId.chunks[0].id = managedId(99_999);
	assert.throws(
		() => validateCorpus(staleContractId),
		/id does not match the current search contract/,
	);

	const staleCorpusVersion = createCorpus();
	staleCorpusVersion.version = 'd'.repeat(20);
	assert.throws(
		() => validateCorpus(staleCorpusVersion),
		/does not match its commits and vector IDs/,
	);
});

test('既存IDも全件再embed・upsertして同一ID破損を修復し、mutation完了を待つ', async () => {
	const corpus = createCorpus();
	const corpusFile = await writeCorpus(corpus);
	const newChunk = corpus.chunks.at(-1);
	const staleId = managedId(10_000);
	const existingIds = [
		...corpus.chunks.slice(0, -1).map(({ id }) => id),
		staleId,
	];
	const calls = [];
	let listCalls = 0;
	let infoCalls = 0;

	const fetchImpl = async (input, init = {}) => {
		const url = String(input);
		const authorization = new Headers(init.headers).get('Authorization');
		calls.push({ url, method: init.method || 'GET', authorization });

		if (url.endsWith(`/vectorize/v2/indexes/${PRODUCTION_INDEX}`)) {
			return indexResponse();
		}
		if (url.includes('/list?')) {
			listCalls += 1;
			const ids =
				listCalls === 1
					? existingIds
					: corpus.chunks.map(({ id }) => id);
			return cloudflareResponse({
				vectors: ids.map((id) => ({ id })),
				isTruncated: false,
			});
		}
		if (url === WORKERS_AI_ENDPOINT) {
			const body = JSON.parse(init.body);
			assert.equal(body.truncate_inputs, false);
			return workersAiResponse(body.text.map(() => embedding));
		}
		if (url.endsWith('/upsert')) {
			const body = await init.body.get('vectors').text();
			const vectors = body
				.trim()
				.split('\n')
				.map((line) => JSON.parse(line));
			assert.equal(vectors.length, corpus.vectorCount);
			const vector = vectors.find(({ id }) => id === newChunk.id);
			assert.equal(vector.values.length, 1024);
			assert.equal(vector.namespace, newChunk.namespace);
			return cloudflareResponse({ mutationId: 'mutation-upsert' });
		}
		if (url.endsWith('/delete_by_ids')) {
			assert.deepEqual(JSON.parse(init.body), { ids: [staleId] });
			return cloudflareResponse({ mutationId: 'mutation-delete' });
		}
		if (url.endsWith('/info')) {
			infoCalls += 1;
			return cloudflareResponse({
				processedUpToMutation:
					infoCalls === 1 ? 'mutation-upsert' : 'mutation-delete',
			});
		}
		throw new Error(`Unexpected request: ${url}`);
	};

	const result = await syncVectorize({
		...liveSyncOptions(corpus, corpusFile),
		fetchImpl,
		logger: silentLogger,
	});

	assert.equal(result.existing, 80);
	assert.equal(result.upserted, corpus.vectorCount);
	assert.equal(result.deleted, 1);
	assert.equal(result.mutationId, 'mutation-delete');
	assert.equal(result.verifiedVectorCount, corpus.vectorCount);
	assert.equal(listCalls, 2);
	assert.equal(
		calls.filter(({ url }) => url === WORKERS_AI_ENDPOINT).length,
		5,
	);
	assert.ok(
		calls
			.filter(({ url }) => url === WORKERS_AI_ENDPOINT)
			.every(({ authorization }) => authorization === 'Bearer token'),
	);
	assert.ok(
		calls
			.filter(({ url }) => url !== WORKERS_AI_ENDPOINT)
			.every(({ authorization }) => authorization === 'Bearer token'),
	);
	assert.ok(
		calls.findIndex(({ url }) => url.endsWith('/info')) <
			calls.findIndex(({ url }) => url.endsWith('/delete_by_ids')),
		'upsert mutation must be processed before stale IDs are deleted',
	);
});

test('embeddingを16件、HTTP upsertを200件以下に分割する', async () => {
	const corpus = createCorpus({ vectorCount: 201, japaneseCount: 150 });
	const corpusFile = await writeCorpus(corpus);
	const embeddingBatchSizes = [];
	const upsertBatchSizes = [];
	let mutationNumber = 0;
	let listCalls = 0;

	const fetchImpl = async (input, init = {}) => {
		const url = String(input);
		if (url.endsWith(`/vectorize/v2/indexes/${PRODUCTION_INDEX}`)) {
			return indexResponse();
		}
		if (url.includes('/list?')) {
			listCalls += 1;
			const vectors =
				listCalls === 1
					? []
					: listCalls === 2
						? [
								...corpus.chunks
									.slice(0, -1)
									.map(({ id }) => ({ id })),
								{ id: managedId(50_000) },
							]
						: corpus.chunks.map(({ id }) => ({ id }));
			return cloudflareResponse({
				vectors,
				isTruncated: false,
			});
		}
		if (url === WORKERS_AI_ENDPOINT) {
			const count = JSON.parse(init.body).text.length;
			embeddingBatchSizes.push(count);
			return workersAiResponse(Array.from({ length: count }, () => embedding));
		}
		if (url.endsWith('/upsert')) {
			const body = await init.body.get('vectors').text();
			const count = body.trim().split('\n').length;
			upsertBatchSizes.push(count);
			mutationNumber += 1;
			return cloudflareResponse({
				mutationId: `mutation-upsert-${mutationNumber}`,
			});
		}
		if (url.endsWith('/info')) {
			return cloudflareResponse({
				processedUpToMutation: `mutation-upsert-${mutationNumber}`,
			});
		}
		throw new Error(`Unexpected request: ${url}`);
	};

	const result = await syncVectorize({
		...liveSyncOptions(corpus, corpusFile),
		fetchImpl,
		sleepImpl: async () => {},
		logger: silentLogger,
	});

	assert.deepEqual(
		embeddingBatchSizes,
		[16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 9],
	);
	assert.deepEqual(upsertBatchSizes, [200, 1]);
	assert.equal(result.upserted, 201);
	assert.equal(result.mutationId, 'mutation-upsert-2');
	assert.equal(listCalls, 3);
});

test('同じcorpusの再同期でも全件を修復upsertする', async () => {
	const corpus = createCorpus();
	const corpusFile = await writeCorpus(corpus);
	let embeddingCount = 0;
	let upsertCount = 0;
	let listCalls = 0;

	const fetchImpl = async (input, init = {}) => {
		const url = String(input);
		if (url.endsWith(`/vectorize/v2/indexes/${PRODUCTION_INDEX}`)) {
			return indexResponse();
		}
		if (url.includes('/list?')) {
			listCalls += 1;
			return cloudflareResponse({
				vectors: corpus.chunks.map(({ id }) => ({ id })),
				isTruncated: false,
			});
		}
		if (url === WORKERS_AI_ENDPOINT) {
			const count = JSON.parse(init.body).text.length;
			embeddingCount += count;
			return workersAiResponse(Array.from({ length: count }, () => embedding));
		}
		if (url.endsWith('/upsert')) {
			upsertCount += 1;
			return cloudflareResponse({ mutationId: 'mutation-repair' });
		}
		if (url.endsWith('/info')) {
			return cloudflareResponse({
				processedUpToMutation: 'mutation-repair',
			});
		}
		throw new Error(`Unexpected request: ${url}`);
	};

	const result = await syncVectorize({
		...liveSyncOptions(corpus, corpusFile),
		fetchImpl,
		logger: silentLogger,
	});

	assert.equal(result.upserted, corpus.vectorCount);
	assert.equal(result.deleted, 0);
	assert.equal(result.mutationId, 'mutation-repair');
	assert.equal(embeddingCount, corpus.vectorCount);
	assert.equal(upsertCount, 1);
	assert.equal(listCalls, 2);
});

test('20%を超えるdeleteを既定で拒否し明示override時だけ許可する', async () => {
	const corpus = createCorpus();
	const corpusFile = await writeCorpus(corpus);
	const staleIds = Array.from({ length: 21 }, (_, index) =>
		managedId(20_000 + index),
	);
	const currentIds = [
		...corpus.chunks.map(({ id }) => id),
		...staleIds,
	];
	let deleteRequests = 0;
	let listCalls = 0;
	let infoCalls = 0;

	const fetchImpl = async (input, init = {}) => {
		const url = String(input);
		if (url.endsWith(`/vectorize/v2/indexes/${PRODUCTION_INDEX}`)) {
			return indexResponse();
		}
		if (url.includes('/list?')) {
			listCalls += 1;
			const ids =
				listCalls <= 2
					? currentIds
					: corpus.chunks.map(({ id }) => id);
			return cloudflareResponse({
				vectors: ids.map((id) => ({ id })),
				isTruncated: false,
			});
		}
		if (url.endsWith('/delete_by_ids')) {
			deleteRequests += 1;
			assert.deepEqual(JSON.parse(init.body), { ids: staleIds });
			return cloudflareResponse({ mutationId: 'mutation-delete' });
		}
		if (url === WORKERS_AI_ENDPOINT) {
			const count = JSON.parse(init.body).text.length;
			return workersAiResponse(Array.from({ length: count }, () => embedding));
		}
		if (url.endsWith('/upsert')) {
			return cloudflareResponse({ mutationId: 'mutation-upsert' });
		}
		if (url.endsWith('/info')) {
			infoCalls += 1;
			return cloudflareResponse({
				processedUpToMutation:
					infoCalls === 1 ? 'mutation-upsert' : 'mutation-delete',
			});
		}
		throw new Error(`Unexpected request: ${url}`);
	};

	await assert.rejects(
		syncVectorize({
			...liveSyncOptions(corpus, corpusFile),
			fetchImpl,
			logger: silentLogger,
		}),
		/--allow-large-delete/,
	);
	assert.equal(deleteRequests, 0);

	const result = await syncVectorize({
		...liveSyncOptions(corpus, corpusFile),
		allowLargeDelete: true,
		fetchImpl,
		logger: silentLogger,
	});
	assert.equal(result.deleted, staleIds.length);
	assert.equal(deleteRequests, 1);
});

test('欠損indexを自動作成せずfail closedする', async () => {
	const corpus = createCorpus();
	const corpusFile = await writeCorpus(corpus);
	const calls = [];

	await assert.rejects(
		syncVectorize({
			...liveSyncOptions(corpus, corpusFile),
			fetchImpl: async (input, init = {}) => {
				calls.push({ url: String(input), method: init.method || 'GET' });
				return cloudflareResponse(null, 404);
			},
			logger: silentLogger,
		}),
		/not provisioned; refusing to create infrastructure/,
	);
	assert.deepEqual(
		calls.map(({ method }) => method),
		['GET'],
	);
});

test('mutation後に余計な並行IDが残れば厳密収束をtimeoutで拒否する', async () => {
	const corpus = createCorpus();
	const corpusFile = await writeCorpus(corpus);
	const unexpectedId = managedId(60_000);
	let listCalls = 0;
	let now = 0;

	const fetchImpl = async (input, init = {}) => {
		const url = String(input);
		if (url.endsWith(`/vectorize/v2/indexes/${PRODUCTION_INDEX}`)) {
			return indexResponse();
		}
		if (url.includes('/list?')) {
			listCalls += 1;
			return cloudflareResponse({
				vectors:
					listCalls === 1
						? []
						: [
								...corpus.chunks.map(({ id }) => ({ id })),
								{ id: unexpectedId },
							],
				isTruncated: false,
			});
		}
		if (url === WORKERS_AI_ENDPOINT) {
			const count = JSON.parse(init.body).text.length;
			return workersAiResponse(Array.from({ length: count }, () => embedding));
		}
		if (url.endsWith('/upsert')) {
			return cloudflareResponse({ mutationId: 'mutation-upsert' });
		}
		if (url.endsWith('/info')) {
			return cloudflareResponse({
				processedUpToMutation: 'mutation-upsert',
			});
		}
		throw new Error(`Unexpected request: ${url}`);
	};

	await assert.rejects(
		syncVectorize({
			...liveSyncOptions(corpus, corpusFile),
			fetchImpl,
			convergenceWaitTimeoutMs: 10,
			convergencePollIntervalMs: 5,
			nowImpl: () => now,
			sleepImpl: async (milliseconds) => {
				now += milliseconds;
			},
			logger: silentLogger,
		}),
		/did not converge.*missing 0, unexpected 1/,
	);
	assert.equal(listCalls, 4);
});

test('非管理形式の現存IDがあればmutation前にfail closedする', async () => {
	const corpus = createCorpus();
	const corpusFile = await writeCorpus(corpus);
	let mutationRequested = false;

	const fetchImpl = async (input) => {
		const url = String(input);
		if (url.endsWith(`/vectorize/v2/indexes/${PRODUCTION_INDEX}`)) {
			return indexResponse();
		}
		if (url.includes('/list?')) {
			return cloudflareResponse({
				vectors: [
					...corpus.chunks.map(({ id }) => ({ id })),
					{ id: 'legacy-vector' },
				],
				isTruncated: false,
			});
		}
		mutationRequested = true;
		throw new Error(`Unexpected request: ${url}`);
	};

	await assert.rejects(
		syncVectorize({
			...liveSyncOptions(corpus, corpusFile),
			fetchImpl,
			logger: silentLogger,
		}),
		/unmanaged vector id/,
	);
	assert.equal(mutationRequested, false);
});

function createCorpus({ vectorCount = 80, japaneseCount = 55 } = {}) {
	const chunkIndexesBySource = new Map();
	const chunks = Array.from({ length: vectorCount }, (_, index) => {
		const locale = index < japaneseCount ? 'ja' : 'en';
		const sourceIndex = index % 60;
		const url = `/${locale}/source-${sourceIndex}/`;
		const text = `vector text ${index}`;
		const sourceKey = `${locale}\n${url}`;
		const chunkIndex = chunkIndexesBySource.get(sourceKey) || 0;
		chunkIndexesBySource.set(sourceKey, chunkIndex + 1);
		return {
			id: createSearchVectorId({
				locale,
				url,
				index: chunkIndex,
				text,
			}),
			namespace: locale,
			text,
			metadata: {
				url,
				title: `Title ${sourceIndex}`,
				section: `Section ${index}`,
				excerpt: `Excerpt ${index}`,
				locale,
			},
		};
	});

	const siteCommit = 'a'.repeat(40);
	const contentCommit = 'b'.repeat(40);
	return {
		schemaVersion: 1,
		version: createSearchCorpusVersion({
			siteCommit,
			contentCommit,
			vectorIds: chunks.map(({ id }) => id),
		}),
		siteCommit,
		contentCommit,
		embedding: {
			model: '@cf/baai/bge-m3',
			dimensions: 1024,
			metric: 'cosine',
		},
		chunking: {
			targetCharacters: 850,
			maximumCharacters: 1200,
			overlapCharacters: 120,
		},
		sourceCount: new Set(chunks.map(({ metadata }) => metadata.url)).size,
		vectorCount: chunks.length,
		localeCounts: countLocales(chunks),
		chunks,
	};
}

function liveSyncOptions(corpus, corpusFile, overrides = {}) {
	return {
		accountId: ACECORE_CLOUDFLARE_ACCOUNT_ID,
		apiToken: 'token',
		trustedAutomation: true,
		target: 'production',
		confirmProduction: corpus.version,
		expectedSiteCommit: corpus.siteCommit,
		expectedContentCommit: corpus.contentCommit,
		expectedCorpusVersion: corpus.version,
		corpusFile,
		...overrides,
	};
}

function countLocales(chunks) {
	return Object.fromEntries(
		['ja', 'en'].map((locale) => [
			locale,
			chunks.filter(({ namespace }) => namespace === locale).length,
		]),
	);
}

function managedId(value) {
	return `wf-v1-${value.toString(16).padStart(48, '0')}`;
}

async function writeCorpus(corpus) {
	const root = await mkdtemp(join(tmpdir(), 'world-foundation-vectorize-'));
	temporaryRoots.push(root);
	const corpusFile = join(root, 'corpus.json');
	await writeFile(corpusFile, JSON.stringify(corpus), 'utf8');
	return corpusFile;
}

function indexResponse() {
	return cloudflareResponse({
		name: PRODUCTION_INDEX,
		config: { dimensions: 1024, metric: 'cosine' },
	});
}

function workersAiResponse(data, status = 200, headers = {}) {
	return new Response(
		JSON.stringify({
			success: status >= 200 && status < 300,
			result: {
				data,
				shape: [data.length, 1024],
				pooling: 'cls',
			},
			errors: [],
			messages: [],
		}),
		{
			status,
			headers: { 'Content-Type': 'application/json', ...headers },
		},
	);
}

function cloudflareResponse(result, status = 200, headers = {}) {
	return new Response(
		JSON.stringify({
			success: status >= 200 && status < 300,
			result,
			errors: [],
			messages: [],
		}),
		{
			status,
			headers: { 'Content-Type': 'application/json', ...headers },
		},
	);
}

const silentLogger = { log() {} };
