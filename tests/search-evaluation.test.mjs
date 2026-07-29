import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	DEFAULT_THRESHOLDS,
	evaluateFixture,
	evaluationExitCode,
	loadFixtures,
	normalizeOrigin,
	runEvaluation,
	validateFixtures,
} from '../scripts/evaluate-search.mjs';

const ORIGIN = 'https://preview.example.test';
const CLIENT_ID = '018f1f3e-7b2c-7a11-8d45-123456789abc';
const TEST_FIXTURES = [
	{
		id: 'ja-test-vision',
		locale: 'ja',
		query: 'ログへ残してはいけない評価質問',
		expected: '/docs/00-vision/',
		alternate: ['/'],
	},
	{
		id: 'en-test-audit',
		locale: 'en',
		query: 'A private evaluation question that must not be logged',
		expected: '/en/modules/audit/',
		alternate: ['/en/docs/05-threat-model/'],
	},
];

test('全fixtureを順次評価しexpected/alternateのtop3 hitを集計する', async () => {
	let activeRequests = 0;
	let maximumActiveRequests = 0;
	const requestBodies = [];
	const logLines = [];
	const logger = {
		log(line) {
			logLines.push(line);
		},
		error(line) {
			logLines.push(line);
		},
	};
	const fetchImpl = async (url, init) => {
		activeRequests += 1;
		maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
		try {
			assert.equal(url.href, `${ORIGIN}/api/search`);
			assert.equal(init.method, 'POST');
			assert.equal(init.headers.Origin, ORIGIN);
			assert.equal(
				init.headers['X-World-Foundation-Search-Client'],
				CLIENT_ID,
			);
			const body = JSON.parse(init.body);
			requestBodies.push(body);
			await Promise.resolve();

			const results =
				body.locale === 'ja'
					? [{ url: '/docs/00-vision/' }]
					: [
							{ url: '/en/docs/02-architecture/' },
							{ url: '/en/docs/05-threat-model/' },
						];
			return Response.json(
				{ ok: true, requestId: crypto.randomUUID(), results },
				{ headers: { 'Content-Type': 'application/json' } },
			);
		} finally {
			activeRequests -= 1;
		}
	};

	const summary = await runEvaluation({
		fixtures: TEST_FIXTURES,
		origin: ORIGIN,
		fetchImpl,
		clientId: CLIENT_ID,
		logger,
		thresholds: {
			minExpectedTop3Rate: 0.5,
			minAcceptableTop3Rate: 1,
			minLocaleAcceptableTop3Rate: 1,
		},
	});

	assert.equal(maximumActiveRequests, 1);
	assert.deepEqual(requestBodies, [
		{ query: TEST_FIXTURES[0].query, locale: 'ja' },
		{ query: TEST_FIXTURES[1].query, locale: 'en' },
	]);
	assert.equal(summary.passed, true);
	assert.equal(summary.expectedHits, 1);
	assert.equal(summary.alternateHits, 1);
	assert.equal(summary.acceptableHits, 2);
	assert.equal(summary.byLocale.ja.acceptableTop3Rate, 1);
	assert.equal(summary.byLocale.en.acceptableTop3Rate, 1);
	assert.equal(evaluationExitCode(summary), 0);
	assert.ok(
		TEST_FIXTURES.every(
			(fixture) => !logLines.join('\n').includes(fixture.query),
		),
		'raw query must not appear in evaluator logs',
	);
});

test('23 fixtureをclient 20回/分の固定窓を超えずに全件評価する', async () => {
	const fixtures = await loadFixtures();
	const fixturesByQuery = new Map(
		fixtures.map((fixture) => [fixture.query, fixture]),
	);
	let currentTime = 10_000;
	const requestTimes = [];
	const sleepDurations = [];
	const clientIds = new Set();
	const logger = { log() {}, error() {} };

	const summary = await runEvaluation({
		fixtures,
		origin: ORIGIN,
		clientId: CLIENT_ID,
		logger,
		nowImpl: () => currentTime,
		sleepImpl: async (milliseconds) => {
			sleepDurations.push(milliseconds);
			currentTime += milliseconds;
		},
		fetchImpl: async (_url, init) => {
			requestTimes.push(currentTime);
			clientIds.add(init.headers['X-World-Foundation-Search-Client']);
			const body = JSON.parse(init.body);
			const fixture = fixturesByQuery.get(body.query);
			assert.ok(fixture);
			return Response.json(
				{
					ok: true,
					results: [{ url: fixture.expected[0] }],
				},
				{ headers: { 'Content-Type': 'application/json' } },
			);
		},
	});

	const requestsPerWindow = new Map();
	for (const requestTime of requestTimes) {
		const windowStart = Math.floor(requestTime / 60_000) * 60_000;
		requestsPerWindow.set(
			windowStart,
			(requestsPerWindow.get(windowStart) || 0) + 1,
		);
	}

	assert.equal(summary.passed, true);
	assert.equal(summary.total, 23);
	assert.equal(requestTimes.length, 23);
	assert.deepEqual([...clientIds], [CLIENT_ID]);
	assert.deepEqual(sleepDurations, [51_000]);
	assert.ok(
		[...requestsPerWindow.values()].every((count) => count <= 20),
		'evaluator must not issue more than 20 requests in a fixed minute',
	);
});

test('hit率が閾値未満なら失敗としてnonzero exit codeを返す', async () => {
	const logger = { log() {}, error() {} };
	const fetchImpl = async () =>
		Response.json(
			{
				ok: true,
				results: [{ url: '/docs/03-roadmap/' }],
			},
			{ headers: { 'Content-Type': 'application/json; charset=utf-8' } },
		);

	const summary = await runEvaluation({
		fixtures: [TEST_FIXTURES[0]],
		origin: ORIGIN,
		fetchImpl,
		clientId: CLIENT_ID,
		logger,
		thresholds: DEFAULT_THRESHOLDS,
	});

	assert.equal(summary.passed, false);
	assert.equal(summary.expectedTop3Rate, 0);
	assert.equal(summary.acceptableTop3Rate, 0);
	assert.deepEqual(summary.failedChecks, [
		'expected_top3_rate',
		'acceptable_top3_rate',
		'locale_acceptable_top3_rate',
	]);
	assert.equal(evaluationExitCode(summary), 1);
});

test('originはpathやcredentialを含まないHTTPS originだけを許可する', () => {
	assert.equal(normalizeOrigin(`${ORIGIN}/`), ORIGIN);
	assert.throws(() => normalizeOrigin('http://preview.example.test'), {
		name: 'SearchEvaluationError',
	});
	assert.throws(() => normalizeOrigin(`${ORIGIN}/docs/`), {
		name: 'SearchEvaluationError',
	});
	assert.throws(() => normalizeOrigin('https://user:pass@example.test'), {
		name: 'SearchEvaluationError',
	});
});

test('API responseのschemaとroot-relative URLを検証する', async () => {
	const [fixture] = validateFixtures([TEST_FIXTURES[0]]);

	await assert.rejects(
		evaluateFixture(fixture, {
			origin: ORIGIN,
			clientId: CLIENT_ID,
			fetchImpl: async () =>
				new Response('<html>not json</html>', {
					status: 200,
					headers: { 'Content-Type': 'text/html' },
				}),
		}),
		/response must use application\/json/,
	);

	await assert.rejects(
		evaluateFixture(fixture, {
			origin: ORIGIN,
			clientId: CLIENT_ID,
			fetchImpl: async () =>
				Response.json({
					ok: true,
					results: [{ url: 'https://attacker.example/' }],
				}),
		}),
		/root-relative public route/,
	);

	await assert.rejects(
		evaluateFixture(fixture, {
			origin: ORIGIN,
			clientId: CLIENT_ID,
			fetchImpl: async () =>
				Response.json(
					{ ok: false, error: { code: 'unavailable' } },
					{ status: 503 },
				),
		}),
		/HTTP 503/,
	);
});

test('既定fixtureは15件の日本語と8件の英語で構成する', async () => {
	const fixtures = await loadFixtures();
	assert.equal(fixtures.length, 23);
	assert.equal(fixtures.filter((fixture) => fixture.locale === 'ja').length, 15);
	assert.equal(fixtures.filter((fixture) => fixture.locale === 'en').length, 8);
	assert.equal(new Set(fixtures.map((fixture) => fixture.id)).size, 23);
});
