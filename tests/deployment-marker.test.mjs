import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBuildMetadata } from '../scripts/write-build-meta.mjs';
import {
	assertDeployedBuild,
	parseBuildMetadata,
	waitForDeployment,
	waitForExactBuild,
} from '../scripts/wait-for-deployment.mjs';

const SITE_COMMIT = 'a'.repeat(40);
const CONTENT_COMMIT = 'b'.repeat(40);
const CORPUS_VERSION = 'c'.repeat(20);

test('build markerにsite/content commitとcorpus versionを固定する', () => {
	const marker = createBuildMetadata({
		siteCommit: SITE_COMMIT.toUpperCase(),
		contentCommit: CONTENT_COMMIT.toUpperCase(),
		version: CORPUS_VERSION.toUpperCase(),
	});

	assert.deepEqual(marker, {
		schemaVersion: 1,
		siteCommit: SITE_COMMIT,
		contentCommit: CONTENT_COMMIT,
		searchCorpusVersion: CORPUS_VERSION,
	});
	assert.deepEqual(parseBuildMetadata(JSON.stringify(marker)), marker);
	assert.throws(
		() =>
			parseBuildMetadata(
				JSON.stringify({
					...marker,
					contentCommit: 'not-a-commit',
				}),
			),
		/content commit/,
	);
});

test('公開中のsite/content/corpusがすべて一致した場合だけ同期を許可する', async () => {
	const deployed = {
		schemaVersion: 1,
		siteCommit: SITE_COMMIT,
		contentCommit: CONTENT_COMMIT,
		searchCorpusVersion: CORPUS_VERSION,
	};
	const fetchImpl = async () =>
		Response.json(deployed, {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	const silentLogger = { log() {} };

	await assert.doesNotReject(
		assertDeployedBuild(
			'https://world-foundation.acecore.net/.well-known/world-foundation-build.json',
			{
				siteCommit: SITE_COMMIT,
				contentCommit: CONTENT_COMMIT,
				version: CORPUS_VERSION,
			},
			{ fetchImpl, logger: silentLogger },
		),
	);
	await assert.rejects(
		assertDeployedBuild(
			'https://world-foundation.acecore.net/.well-known/world-foundation-build.json',
			{
				siteCommit: SITE_COMMIT,
				contentCommit: 'd'.repeat(40),
				version: CORPUS_VERSION,
			},
			{ fetchImpl, logger: silentLogger },
		),
		/content\/search corpus differs/,
	);
});

test('Pages deploymentは一時エラーと旧SHAを越えてexpected SHAを待つ', async () => {
	const responses = [
		new Response('temporarily unavailable', { status: 503 }),
		Response.json({
			schemaVersion: 1,
			siteCommit: 'd'.repeat(40),
			contentCommit: CONTENT_COMMIT,
			searchCorpusVersion: CORPUS_VERSION,
		}),
		Response.json({
			schemaVersion: 1,
			siteCommit: SITE_COMMIT,
			contentCommit: CONTENT_COMMIT,
			searchCorpusVersion: CORPUS_VERSION,
		}),
	];
	const events = [];

	const deployed = await waitForDeployment(
		'https://world-foundation.acecore.net/.well-known/world-foundation-build.json',
		SITE_COMMIT,
		{
			timeoutMs: 1_000,
			pollMs: 0,
			fetchImpl: async () => responses.shift(),
			logger: { log(event) { events.push(JSON.parse(event)); } },
			sleepImpl: async () => {},
		},
	);

	assert.equal(responses.length, 0);
	assert.equal(deployed.siteCommit, SITE_COMMIT);
	assert.deepEqual(events, [
		{
			event: 'pages_deployment_ready',
			schemaVersion: 1,
			siteCommit: SITE_COMMIT,
			contentCommit: CONTENT_COMMIT,
			searchCorpusVersion: CORPUS_VERSION,
		},
	]);
});

test('同じsite SHAでも新しいcontent/corpus三値が揃うまで待つ', async () => {
	const expected = {
		siteCommit: SITE_COMMIT,
		contentCommit: CONTENT_COMMIT,
		searchCorpusVersion: CORPUS_VERSION,
	};
	const oldBuild = {
		schemaVersion: 1,
		siteCommit: SITE_COMMIT,
		contentCommit: 'd'.repeat(40),
		searchCorpusVersion: 'e'.repeat(20),
	};
	const responses = [
		Response.json(oldBuild),
		Response.json({ schemaVersion: 1, ...expected }),
	];

	const deployed = await waitForExactBuild(
		'https://world-foundation.acecore.net/.well-known/world-foundation-build.json',
		expected,
		{
			timeoutMs: 1_000,
			pollMs: 0,
			fetchImpl: async () => responses.shift(),
			logger: { log() {} },
			sleepImpl: async () => {},
		},
	);

	assert.equal(responses.length, 0);
	assert.deepEqual(deployed, {
		schemaVersion: 1,
		...expected,
	});
});
