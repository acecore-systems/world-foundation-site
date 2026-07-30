import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBuildMetadata } from '../scripts/write-build-meta.mjs';
import {
	assertDeployedBuild,
	parseBuildMetadata,
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
